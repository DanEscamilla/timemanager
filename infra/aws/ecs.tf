resource "aws_cloudwatch_log_group" "auth" {
  name              = "/ecs/${local.name_prefix}/user-manager-api"
  retention_in_days = 14
  tags              = local.common_tags
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${local.name_prefix}/timemanager-api"
  retention_in_days = 14
  tags              = local.common_tags
}

resource "aws_iam_role" "ecs_execution" {
  name = "${local.name_prefix}-ecs-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })

  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_execution_secrets" {
  name = "${local.name_prefix}-ecs-execution-secrets"
  role = aws_iam_role.ecs_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = [aws_secretsmanager_secret.app.arn]
    }]
  })
}

resource "aws_iam_role" "ecs_task" {
  name = "${local.name_prefix}-ecs-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })

  tags = local.common_tags
}

# Required for ECS Exec (aws ecs execute-command / infra/aws/scripts/ecs-shell.sh).
resource "aws_iam_role_policy" "ecs_task_exec" {
  name = "${local.name_prefix}-ecs-task-exec"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "ssmmessages:CreateControlChannel",
        "ssmmessages:CreateDataChannel",
        "ssmmessages:OpenControlChannel",
        "ssmmessages:OpenDataChannel",
      ]
      Resource = "*"
    }]
  })
}

resource "aws_ecs_cluster" "main" {
  name = local.name_prefix

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = local.common_tags
}

resource "aws_ecs_task_definition" "auth" {
  family                   = "${local.name_prefix}-user-manager-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.auth_cpu
  memory                   = var.auth_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name      = "user-manager-api"
    image     = "${aws_ecr_repository.auth.repository_url}:${var.auth_image_tag}"
    essential = true
    portMappings = [{
      containerPort = 3001
      protocol      = "tcp"
    }]
    environment = [
      { name = "PORT", value = "3001" },
      { name = "API_DOMAIN", value = local.auth_domain },
      { name = "WEBSITE_DOMAIN", value = local.account_domain },
      { name = "ALLOWED_ORIGINS", value = local.allowed_origins },
      { name = "SUPERTOKENS_CONNECTION_URI", value = var.supertokens_connection_uri },
    ]
    secrets = concat(
      [],
      [
        for key in keys(var.oauth_secrets) : {
          name      = key
          valueFrom = "${aws_secretsmanager_secret.app.arn}:${key}::"
        }
      ]
    )
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.auth.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "ecs"
      }
    }
  }])

  tags = local.common_tags
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${local.name_prefix}-timemanager-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.api_cpu
  memory                   = var.api_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name      = "timemanager-api"
    image     = "${aws_ecr_repository.api.repository_url}:${var.api_image_tag}"
    essential = true
    portMappings = [{
      containerPort = 3000
      protocol      = "tcp"
    }]
    environment = [
      { name = "PORT", value = "3000" },
      { name = "AUTH_API_DOMAIN", value = local.auth_domain },
    ]
    secrets = [
      {
        name      = "DATABASE_URL"
        valueFrom = "${aws_secretsmanager_secret.app.arn}:DATABASE_URL::"
      }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.api.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "ecs"
      }
    }
  }])

  tags = local.common_tags
}

# One-shot migration task (same image, override command at run time).
resource "aws_ecs_task_definition" "migrate" {
  family                   = "${local.name_prefix}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name      = "migrate"
    image     = "${aws_ecr_repository.api.repository_url}:${var.api_image_tag}"
    essential = true
    command   = ["deno", "task", "migrate"]
    environment = [
      { name = "AUTH_API_DOMAIN", value = local.auth_domain },
    ]
    secrets = [
      {
        name      = "DATABASE_URL"
        valueFrom = "${aws_secretsmanager_secret.app.arn}:DATABASE_URL::"
      }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.api.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "migrate"
      }
    }
  }])

  tags = local.common_tags
}

resource "aws_ecs_service" "auth" {
  name                   = "user-manager-api"
  cluster                = aws_ecs_cluster.main.id
  task_definition        = aws_ecs_task_definition.auth.arn
  desired_count          = var.desired_count
  launch_type            = "FARGATE"
  enable_execute_command = true

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.auth.arn
    container_name   = "user-manager-api"
    container_port   = 3001
  }

  depends_on = [aws_lb_listener.https]

  tags = local.common_tags

  lifecycle {
    ignore_changes = [task_definition]
  }
}

resource "aws_ecs_service" "api" {
  name                   = "timemanager-api"
  cluster                = aws_ecs_cluster.main.id
  task_definition        = aws_ecs_task_definition.api.arn
  desired_count          = var.desired_count
  launch_type            = "FARGATE"
  enable_execute_command = true

  # Allow boot time before ALB /health failures count against the task.
  health_check_grace_period_seconds = 120

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "timemanager-api"
    container_port   = 3000
  }

  depends_on = [aws_lb_listener.https, aws_db_instance.main]

  tags = local.common_tags

  lifecycle {
    ignore_changes = [task_definition]
  }
}
