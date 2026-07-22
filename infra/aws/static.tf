resource "aws_s3_bucket" "flutter_web" {
  bucket = "${local.name_prefix}-flutter-web-${data.aws_caller_identity.current.account_id}"
  tags   = local.common_tags
}

resource "aws_s3_bucket" "spendmanager_web" {
  bucket = "${local.name_prefix}-spendmanager-web-${data.aws_caller_identity.current.account_id}"
  tags   = local.common_tags
}

resource "aws_s3_bucket" "user_manager_web" {
  bucket = "${local.name_prefix}-user-manager-web-${data.aws_caller_identity.current.account_id}"
  tags   = local.common_tags
}

resource "aws_s3_bucket_public_access_block" "flutter_web" {
  bucket                  = aws_s3_bucket.flutter_web.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_public_access_block" "spendmanager_web" {
  bucket                  = aws_s3_bucket.spendmanager_web.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_public_access_block" "user_manager_web" {
  bucket                  = aws_s3_bucket.user_manager_web.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "${local.name_prefix}-oac"
  description                       = "OAC for SPA buckets"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "flutter_web" {
  count               = local.edge_enabled ? 1 : 0
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${local.name_prefix} Flutter web"
  default_root_object = "index.html"
  aliases             = [local.app_hostname]
  price_class         = "PriceClass_100"

  origin {
    domain_name              = aws_s3_bucket.flutter_web.bucket_regional_domain_name
    origin_id                = "s3-flutter-web"
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "s3-flutter-web"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }
  }

  # SPA client-side routing
  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }

  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = local.web_certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  tags = local.common_tags
}

resource "aws_cloudfront_distribution" "spendmanager_web" {
  count               = local.edge_enabled ? 1 : 0
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${local.name_prefix} spendmanager web"
  default_root_object = "index.html"
  aliases             = [local.spend_hostname]
  price_class         = "PriceClass_100"

  origin {
    domain_name              = aws_s3_bucket.spendmanager_web.bucket_regional_domain_name
    origin_id                = "s3-spendmanager-web"
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "s3-spendmanager-web"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }
  }

  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }

  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = local.web_certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  tags = local.common_tags
}

resource "aws_cloudfront_distribution" "user_manager_web" {
  count               = local.edge_enabled ? 1 : 0
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${local.name_prefix} user-manager-web"
  default_root_object = "index.html"
  aliases             = [local.account_hostname]
  price_class         = "PriceClass_100"

  origin {
    domain_name              = aws_s3_bucket.user_manager_web.bucket_regional_domain_name
    origin_id                = "s3-user-manager-web"
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "s3-user-manager-web"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }
  }

  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }

  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = local.web_certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  tags = local.common_tags
}

data "aws_iam_policy_document" "flutter_web_oac" {
  count = local.edge_enabled ? 1 : 0

  statement {
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.flutter_web.arn}/*"]
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.flutter_web[0].arn]
    }
  }
}

data "aws_iam_policy_document" "spendmanager_web_oac" {
  count = local.edge_enabled ? 1 : 0

  statement {
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.spendmanager_web.arn}/*"]
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.spendmanager_web[0].arn]
    }
  }
}

data "aws_iam_policy_document" "user_manager_web_oac" {
  count = local.edge_enabled ? 1 : 0

  statement {
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.user_manager_web.arn}/*"]
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.user_manager_web[0].arn]
    }
  }
}

resource "aws_s3_bucket_policy" "flutter_web" {
  count  = local.edge_enabled ? 1 : 0
  bucket = aws_s3_bucket.flutter_web.id
  policy = data.aws_iam_policy_document.flutter_web_oac[0].json
}

resource "aws_s3_bucket_policy" "spendmanager_web" {
  count  = local.edge_enabled ? 1 : 0
  bucket = aws_s3_bucket.spendmanager_web.id
  policy = data.aws_iam_policy_document.spendmanager_web_oac[0].json
}

resource "aws_s3_bucket_policy" "user_manager_web" {
  count  = local.edge_enabled ? 1 : 0
  bucket = aws_s3_bucket.user_manager_web.id
  policy = data.aws_iam_policy_document.user_manager_web_oac[0].json
}
