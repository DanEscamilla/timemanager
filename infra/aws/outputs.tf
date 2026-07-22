output "vpc_id" {
  value = aws_vpc.main.id
}

output "alb_dns_name" {
  value = local.edge_enabled ? aws_lb.main[0].dns_name : null
}

output "ecr_auth_repository_url" {
  value = aws_ecr_repository.auth.repository_url
}

output "ecr_api_repository_url" {
  value = aws_ecr_repository.api.repository_url
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "migrate_task_definition" {
  value = aws_ecs_task_definition.migrate.family
}

output "private_subnet_ids" {
  value = aws_subnet.private[*].id
}

output "ecs_security_group_id" {
  value = aws_security_group.ecs.id
}

output "flutter_web_bucket" {
  value = aws_s3_bucket.flutter_web.bucket
}

output "user_manager_web_bucket" {
  value = aws_s3_bucket.user_manager_web.bucket
}

output "flutter_web_distribution_id" {
  value = local.edge_enabled ? aws_cloudfront_distribution.flutter_web[0].id : null
}

output "user_manager_web_distribution_id" {
  value = local.edge_enabled ? aws_cloudfront_distribution.user_manager_web[0].id : null
}

output "hostnames" {
  value = {
    auth    = local.auth_hostname
    api     = local.api_hostname
    app     = local.app_hostname
    account = local.account_hostname
  }
}

output "secrets_arn" {
  value = aws_secretsmanager_secret.app.arn
}

output "rds_endpoint" {
  value = aws_db_instance.main.address
}

output "rds_identifier" {
  value = aws_db_instance.main.identifier
}

output "hibernating" {
  value = local.hibernating
}

output "hibernating_parameter_name" {
  value = data.aws_ssm_parameter.hibernating.name
}

output "budget_sns_topic_arn" {
  value = aws_sns_topic.budget_alerts.arn
}

output "github_actions_deploy_role_arn" {
  description = "IAM role ARN for GitHub Actions staging deploys (set as AWS_ROLE_ARN secret)."
  value       = aws_iam_role.github_actions_deploy.arn
}
