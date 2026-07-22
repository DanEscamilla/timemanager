resource "aws_acm_certificate" "api" {
  domain_name               = local.auth_hostname
  subject_alternative_names = [local.api_hostname]
  validation_method         = "DNS"

  tags = local.common_tags

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_acm_certificate" "web" {
  provider = aws.us_east_1

  domain_name               = local.app_hostname
  subject_alternative_names = [local.account_hostname, local.spend_hostname]
  validation_method         = "DNS"

  tags = local.common_tags

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "api_cert_validation" {
  for_each = var.hosted_zone_id == "" ? {} : {
    for dvo in aws_acm_certificate.api.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = var.hosted_zone_id
}

resource "aws_route53_record" "web_cert_validation" {
  for_each = var.hosted_zone_id == "" ? {} : {
    for dvo in aws_acm_certificate.web.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = var.hosted_zone_id
}

resource "aws_acm_certificate_validation" "api" {
  count                   = var.hosted_zone_id == "" ? 0 : 1
  certificate_arn         = aws_acm_certificate.api.arn
  validation_record_fqdns = [for r in aws_route53_record.api_cert_validation : r.fqdn]
}

resource "aws_acm_certificate_validation" "web" {
  count                   = var.hosted_zone_id == "" ? 0 : 1
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.web.arn
  validation_record_fqdns = [for r in aws_route53_record.web_cert_validation : r.fqdn]
}

locals {
  alb_certificate_arn = var.hosted_zone_id == "" ? aws_acm_certificate.api.arn : aws_acm_certificate_validation.api[0].certificate_arn
  web_certificate_arn = var.hosted_zone_id == "" ? aws_acm_certificate.web.arn : aws_acm_certificate_validation.web[0].certificate_arn
}
