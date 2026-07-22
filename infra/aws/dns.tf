resource "aws_route53_record" "auth" {
  count   = var.hosted_zone_id != "" && local.edge_enabled ? 1 : 0
  zone_id = var.hosted_zone_id
  name    = local.auth_hostname
  type    = "A"

  alias {
    name                   = aws_lb.main[0].dns_name
    zone_id                = aws_lb.main[0].zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "api" {
  count   = var.hosted_zone_id != "" && local.edge_enabled ? 1 : 0
  zone_id = var.hosted_zone_id
  name    = local.api_hostname
  type    = "A"

  alias {
    name                   = aws_lb.main[0].dns_name
    zone_id                = aws_lb.main[0].zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "app" {
  count   = var.hosted_zone_id != "" && local.edge_enabled ? 1 : 0
  zone_id = var.hosted_zone_id
  name    = local.app_hostname
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.flutter_web[0].domain_name
    zone_id                = aws_cloudfront_distribution.flutter_web[0].hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "spend" {
  count   = var.hosted_zone_id != "" && local.edge_enabled ? 1 : 0
  zone_id = var.hosted_zone_id
  name    = local.spend_hostname
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.spendmanager_web[0].domain_name
    zone_id                = aws_cloudfront_distribution.spendmanager_web[0].hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "account" {
  count   = var.hosted_zone_id != "" && local.edge_enabled ? 1 : 0
  zone_id = var.hosted_zone_id
  name    = local.account_hostname
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.user_manager_web[0].domain_name
    zone_id                = aws_cloudfront_distribution.user_manager_web[0].hosted_zone_id
    evaluate_target_health = false
  }
}
