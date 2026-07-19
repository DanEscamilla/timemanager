locals {
  name_prefix = "${var.project}-${var.environment}"

  auth_hostname    = "auth.${var.domain_name}"
  api_hostname     = "api.${var.domain_name}"
  app_hostname     = "app.${var.domain_name}"
  account_hostname = "account.${var.domain_name}"

  auth_domain    = "https://${local.auth_hostname}"
  api_domain     = "https://${local.api_hostname}"
  app_domain     = "https://${local.app_hostname}"
  account_domain = "https://${local.account_hostname}"

  allowed_origins = join(",", [local.app_domain, local.account_domain])

  common_tags = {
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

data "aws_caller_identity" "current" {}
data "aws_availability_zones" "available" {
  state = "available"
}
