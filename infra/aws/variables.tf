variable "aws_region" {
  description = "Primary AWS region for APIs, RDS, and ALB."
  type        = string
  default     = "us-east-1"
}

variable "project" {
  description = "Name prefix for resources."
  type        = string
  default     = "timemanager"
}

variable "environment" {
  description = "Environment name (e.g. staging, prod)."
  type        = string
  default     = "staging"
}

variable "domain_name" {
  description = "Apex domain (e.g. example.com). Used for auth/api/app/account hostnames."
  type        = string
}

variable "hosted_zone_id" {
  description = "Existing Route 53 hosted zone ID for domain_name. Leave empty to skip DNS records."
  type        = string
  default     = ""
}

variable "create_nat_gateway" {
  description = "Create a NAT Gateway for private subnet egress (required for Fargate pulls + SuperTokens)."
  type        = bool
  default     = true
}

variable "db_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_name" {
  description = "Postgres database name."
  type        = string
  default     = "timemanager"
}

variable "db_username" {
  description = "Postgres master username."
  type        = string
  default     = "timemanager"
}

variable "auth_image_tag" {
  description = "ECR image tag for user-manager-api."
  type        = string
  default     = "latest"
}

variable "api_image_tag" {
  description = "ECR image tag for timemanager-api."
  type        = string
  default     = "latest"
}

variable "auth_cpu" {
  type    = number
  default = 256
}

variable "auth_memory" {
  type    = number
  default = 512
}

variable "api_cpu" {
  type    = number
  default = 256
}

variable "api_memory" {
  type    = number
  default = 512
}

variable "desired_count" {
  description = "Desired ECS tasks per service. Use 0 until images are pushed to ECR, then set to 1+."
  type        = number
  default     = 0
}

variable "supertokens_connection_uri" {
  description = "SuperTokens Core connection URI."
  type        = string
  default     = "https://try.supertokens.com"
}

variable "oauth_secrets" {
  description = "OAuth client credentials stored in Secrets Manager (JSON object keys match env var names)."
  type        = map(string)
  default     = {}
  sensitive   = true
}

variable "monthly_budget_amount" {
  description = "Monthly AWS cost budget in USD. At 100% actual spend, email + kill-switch Lambda hibernate the stack."
  type        = number
}

variable "budget_alert_email" {
  description = "Email for budget notifications (must confirm the SNS subscription once)."
  type        = string
}

variable "github_repository" {
  description = "GitHub repo (OWNER/REPO) allowed to assume the staging deploy role via OIDC."
  type        = string
  default     = "DanEscamilla/timemanager"
}

variable "create_github_oidc_provider" {
  description = "Create the GitHub Actions OIDC provider. Set false if the account already has token.actions.githubusercontent.com."
  type        = bool
  default     = true
}
