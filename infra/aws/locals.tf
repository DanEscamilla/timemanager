data "aws_caller_identity" "current" {}
data "aws_availability_zones" "available" {
  state = "available"
}

# Created by infra/aws/bootstrap; updated by infra-down/up scripts and the budget kill switch.
data "aws_ssm_parameter" "hibernating" {
  name = "/${var.project}-${var.environment}/hibernating"
}

locals {
  name_prefix = "${var.project}-${var.environment}"

  # SSM String params are sensitive by default; this flag is not a secret.
  hibernating       = nonsensitive(data.aws_ssm_parameter.hibernating.value) == "true"
  create_nat        = var.create_nat_gateway && !local.hibernating
  edge_enabled      = !local.hibernating
  ecs_desired_count = local.hibernating ? 0 : var.desired_count

  auth_hostname    = "auth.${var.domain_name}"
  api_hostname     = "api.${var.domain_name}"
  app_hostname     = "app.${var.domain_name}"
  spend_hostname   = "spend.${var.domain_name}"
  account_hostname = "account.${var.domain_name}"

  auth_domain    = "https://${local.auth_hostname}"
  api_domain     = "https://${local.api_hostname}"
  app_domain     = "https://${local.app_hostname}"
  spend_domain   = "https://${local.spend_hostname}"
  account_domain = "https://${local.account_hostname}"

  # spend-api.* is reserved for when spendmanager-api joins the ECS stack.
  spend_api_hostname = "spend-api.${var.domain_name}"
  spend_api_domain   = "https://${local.spend_api_hostname}"

  allowed_origins = join(",", [local.app_domain, local.spend_domain, local.account_domain])

  common_tags = {
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}
