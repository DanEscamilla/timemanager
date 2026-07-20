# One-time remote state bootstrap
#
# Run from this directory after exporting AWS credentials:
#
#   terraform init
#   terraform apply -var="project=timemanager" -var="aws_region=us-east-1"
#
# Then uncomment the backend "s3" block in ../versions.tf and run
# `terraform init -migrate-state` from infra/aws.

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

variable "project" {
  type    = string
  default = "timemanager"
}

variable "environment" {
  type    = string
  default = "staging"
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

provider "aws" {
  region = var.aws_region
}

data "aws_caller_identity" "current" {}

locals {
  name_prefix = "${var.project}-${var.environment}"
}

# Hibernation flag for the main stack. Scripts and the budget kill-switch Lambda
# update this value; Terraform in infra/aws only reads it (never overwrites).
resource "aws_ssm_parameter" "hibernating" {
  name  = "/${local.name_prefix}/hibernating"
  type  = "String"
  value = "false"

  tags = {
    Name      = "${local.name_prefix}-hibernating"
    ManagedBy = "terraform"
  }

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_s3_bucket" "tfstate" {
  bucket = "${var.project}-tfstate-${data.aws_caller_identity.current.account_id}"

  tags = {
    Name      = "${var.project}-tfstate"
    ManagedBy = "terraform"
  }
}

resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket                  = aws_s3_bucket.tfstate.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_dynamodb_table" "tf_locks" {
  name         = "${var.project}-tf-locks"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }

  tags = {
    Name      = "${var.project}-tf-locks"
    ManagedBy = "terraform"
  }
}

output "state_bucket" {
  value = aws_s3_bucket.tfstate.bucket
}

output "lock_table" {
  value = aws_dynamodb_table.tf_locks.name
}

output "hibernating_parameter_name" {
  value = aws_ssm_parameter.hibernating.name
}
