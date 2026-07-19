resource "aws_secretsmanager_secret" "app" {
  name                    = "${local.name_prefix}/app"
  recovery_window_in_days = var.environment == "prod" ? 30 : 0
  tags                    = local.common_tags
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id
  secret_string = jsonencode(merge(
    {
      DATABASE_URL               = local.database_url
      AUTH_API_DOMAIN            = local.auth_domain
      API_DOMAIN                 = local.auth_domain
      WEBSITE_DOMAIN             = local.account_domain
      ALLOWED_ORIGINS            = local.allowed_origins
      SUPERTOKENS_CONNECTION_URI = var.supertokens_connection_uri
    },
    var.oauth_secrets
  ))
}
