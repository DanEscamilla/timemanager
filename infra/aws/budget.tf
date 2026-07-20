# Monthly cost budget + SNS notify + kill-switch Lambda (not gated by hibernation).

resource "aws_sns_topic" "budget_alerts" {
  name = "${local.name_prefix}-budget-alerts"
  tags = local.common_tags
}

data "aws_iam_policy_document" "budget_sns" {
  statement {
    sid    = "AWSBudgetsSNSPublishingPermissions"
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["budgets.amazonaws.com"]
    }
    actions   = ["SNS:Publish"]
    resources = [aws_sns_topic.budget_alerts.arn]
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_sns_topic_policy" "budget_alerts" {
  arn    = aws_sns_topic.budget_alerts.arn
  policy = data.aws_iam_policy_document.budget_sns.json
}

resource "aws_sns_topic_subscription" "budget_email" {
  topic_arn = aws_sns_topic.budget_alerts.arn
  protocol  = "email"
  endpoint  = var.budget_alert_email
}

resource "aws_budgets_budget" "monthly" {
  name         = "${local.name_prefix}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_amount)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_sns_topic_arns  = [aws_sns_topic.budget_alerts.arn]
  }
}

data "archive_file" "kill_switch" {
  type        = "zip"
  source_file = "${path.module}/lambda/kill_switch.py"
  output_path = "${path.module}/.terraform/kill_switch.zip"
}

resource "aws_iam_role" "kill_switch" {
  name = "${local.name_prefix}-budget-kill-switch"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })

  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "kill_switch_logs" {
  role       = aws_iam_role.kill_switch.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "kill_switch" {
  name = "${local.name_prefix}-budget-kill-switch"
  role = aws_iam_role.kill_switch.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ssm:PutParameter", "ssm:GetParameter"]
        Resource = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/${local.name_prefix}/hibernating"
      },
      {
        # UpdateService does not support resource-level permissions reliably.
        Effect   = "Allow"
        Action   = ["ecs:UpdateService", "ecs:DescribeServices", "ecs:ListServices"]
        Resource = ["*"]
      },
      {
        Effect = "Allow"
        Action = [
          "rds:StopDBInstance",
          "rds:DescribeDBInstances"
        ]
        Resource = aws_db_instance.main.arn
      },
      {
        Effect = "Allow"
        Action = [
          "ec2:DescribeNatGateways",
          "ec2:DeleteNatGateway",
          "ec2:ReleaseAddress",
          "ec2:DescribeAddresses"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "elasticloadbalancing:DescribeLoadBalancers",
          "elasticloadbalancing:DeleteLoadBalancer"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "cloudfront:ListDistributions",
          "cloudfront:GetDistribution",
          "cloudfront:GetDistributionConfig",
          "cloudfront:UpdateDistribution"
        ]
        Resource = "*"
      }
    ]
  })
}

resource "aws_lambda_function" "kill_switch" {
  function_name = "${local.name_prefix}-budget-kill-switch"
  role          = aws_iam_role.kill_switch.arn
  handler       = "kill_switch.handler"
  runtime       = "python3.12"
  timeout       = 300
  filename      = data.archive_file.kill_switch.output_path
  source_code_hash = data.archive_file.kill_switch.output_base64sha256

  environment {
    variables = {
      HIBERNATING_PARAMETER = data.aws_ssm_parameter.hibernating.name
      ECS_CLUSTER           = aws_ecs_cluster.main.name
      ECS_SERVICES          = "user-manager-api,timemanager-api"
      RDS_IDENTIFIER        = aws_db_instance.main.identifier
      NAME_PREFIX           = local.name_prefix
    }
  }

  tags = local.common_tags
}

resource "aws_lambda_permission" "kill_switch_sns" {
  statement_id  = "AllowBudgetSNSInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.kill_switch.function_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.budget_alerts.arn
}

resource "aws_sns_topic_subscription" "kill_switch" {
  topic_arn = aws_sns_topic.budget_alerts.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.kill_switch.arn
}
