# AWS deployment

Cloud target for this monorepo: **backend APIs + web frontends** on AWS, structured so a GitHub Actions + OIDC pipeline can mirror the manual steps later.

Architecture deep-dive (full stack vs simplified API-only, comparison, cost): [`aws-architecture.md`](aws-architecture.md).

Hostnames (replace `<domain>`):

| Host | Service |
|------|---------|
| `auth.<domain>` | `user-manager-api` (SuperTokens) |
| `api.<domain>` | `timemanager-api` (GraphQL) |
| `app.<domain>` | Flutter web |
| `account.<domain>` | `user-manager-web` |

Infra lives in [`infra/aws/`](../infra/aws/). Local Docker Postgres (`infra/timemanager-db`) remains the day-to-day dev database.

## Prerequisites

- AWS account + CLI credentials with rights for VPC, ECS, ECR, RDS, S3, CloudFront, ACM, Route 53, Secrets Manager, IAM
- Terraform `>= 1.5`
- Docker, Flutter, pnpm, Node 20 (`.nvmrc`)
- A Route 53 hosted zone for `<domain>`

## One-time bootstrap (remote state)

```bash
cd infra/aws/bootstrap
terraform init
terraform apply -var='project=timemanager' -var='environment=staging' -var='aws_region=us-east-1'
```

Bootstrap creates the S3 state bucket, optional DynamoDB lock table, and the SSM parameter `/timemanager-staging/hibernating` (default `false`). The main stack **reads** that parameter; `up`/`down` scripts and the budget kill-switch Lambda update it.

Set the `backend "s3"` bucket in [`infra/aws/versions.tf`](../infra/aws/versions.tf) to the bootstrap `state_bucket` output (locking uses `use_lockfile`; the bootstrap DynamoDB table is optional/legacy), then:

```bash
cd infra/aws
terraform init -migrate-state
```

If you bootstrapped before hibernation existed, re-apply bootstrap so the SSM parameter is created before the next main-stack plan.

### Existing stack: Terraform state moves

Hibernation wraps ALB / listeners / CloudFront / bucket policies in `count`. Before the first plan after pulling these changes, move addresses so Terraform does not destroy/recreate them:

```bash
cd infra/aws
terraform state mv 'aws_lb.main' 'aws_lb.main[0]'
terraform state mv 'aws_lb_listener.http' 'aws_lb_listener.http[0]'
terraform state mv 'aws_lb_listener.https' 'aws_lb_listener.https[0]'
terraform state mv 'aws_lb_listener_rule.auth' 'aws_lb_listener_rule.auth[0]'
terraform state mv 'aws_lb_listener_rule.api' 'aws_lb_listener_rule.api[0]'
terraform state mv 'aws_cloudfront_distribution.flutter_web' 'aws_cloudfront_distribution.flutter_web[0]'
terraform state mv 'aws_cloudfront_distribution.user_manager_web' 'aws_cloudfront_distribution.user_manager_web[0]'
terraform state mv 'aws_s3_bucket_policy.flutter_web' 'aws_s3_bucket_policy.flutter_web[0]'
terraform state mv 'aws_s3_bucket_policy.user_manager_web' 'aws_s3_bucket_policy.user_manager_web[0]'
```

Then set `monthly_budget_amount` / `budget_alert_email` in `terraform.tfvars` and `terraform apply`.

## Configure and apply infrastructure

```bash
cd infra/aws
cp terraform.tfvars.example terraform.tfvars
# edit domain_name, hosted_zone_id, monthly_budget_amount, budget_alert_email, oauth_secrets, etc.
terraform plan
terraform apply
```

First apply creates networking, RDS, ECR, ALB, CloudFront, Secrets Manager, a monthly cost budget + kill-switch Lambda, and ECS services with **`desired_count = 0`** until images exist.

After apply, confirm the SNS email subscription for budget alerts (inbox subject like **AWS Notification - Subscription Confirmation**).

### Auth / CORS / OAuth (cloud)

Terraform sets Secrets Manager + ECS env from hostnames:

- `API_DOMAIN` = `https://auth.<domain>`
- `WEBSITE_DOMAIN` = `https://account.<domain>`
- `ALLOWED_ORIGINS` = `https://app.<domain>,https://account.<domain>`
- `AUTH_API_DOMAIN` (GraphQL) = `https://auth.<domain>`
- `SUPERTOKENS_CONNECTION_URI` defaults to `https://try.supertokens.com` (self-host later)

In each OAuth provider console, add redirect / callback URLs for SuperTokens on the auth host, typically:

- `https://auth.<domain>/auth/callback/google` (and github / apple / twitter as enabled)
- Flutter web origin `https://app.<domain>` where the provider allows authorized JavaScript origins
- `user-manager-web` origin `https://account.<domain>`

Pass provider client IDs/secrets via `oauth_secrets` in `terraform.tfvars` (merged into Secrets Manager).

## Local env for scripts

Copy [`infra/aws/.local.env.example`](../infra/aws/.local.env.example) → `infra/aws/.local.env` (gitignored). `deploy-apis.sh`, `deploy-web.sh`, `check-health.sh`, `ecs-shell.sh`, `infra-down.sh`, and `infra-up.sh` load it automatically. Already-exported shell vars win over the file. Override path with `LOCAL_ENV_FILE=/path/to/file`.

## Hibernate / wake (cost control)

Like docker-compose down/up for the staging stack. Hibernation keeps VPC, ECS services, RDS data, ECR, S3, secrets, and ACM; sleeps ECS (`desired_count = 0`); **stops** RDS; and destroys NAT, ALB, CloudFront, and Route 53 aliases. Residual cost is mostly RDS storage + small fixed items (not NAT/ALB/Fargate).

```bash
# from repo root
nx run timemanager-aws:down   # or ./infra/aws/scripts/infra-down.sh
nx run timemanager-aws:up     # or ./infra/aws/scripts/infra-up.sh
```

`down` sets SSM `hibernating=true`, runs `terraform apply`, then stops RDS. `up` starts RDS, clears the flag, applies Terraform (recreates edge), then runs `deploy-apis.sh` and `deploy-web.sh`.

**RDS caveat:** AWS may auto-restart a stopped instance after ~7 days. Re-run `down` if that happens while you still want the stack asleep.

### Monthly budget + kill switch

Configure in `terraform.tfvars` (see `terraform.tfvars.example`):

- `monthly_budget_amount` — USD limit for the calendar month
- `budget_alert_email` — notified via the budget SNS topic

At **100% actual** spend, SNS emails you and invokes a Lambda that sets hibernating, scales ECS to 0, stops RDS, deletes NAT/ALB, and disables CloudFront (same intent as `down`). Run `nx run timemanager-aws:down` afterward if you want Terraform state fully reconciled.

Test the kill switch without waiting for spend:

```bash
aws sns publish \
  --topic-arn "$(cd infra/aws && terraform output -raw budget_sns_topic_arn)" \
  --subject "Test budget kill switch" \
  --message "manual test"
```

## Deploy APIs (images + migrate + ECS)

```bash
# from repo root
./infra/aws/scripts/deploy-apis.sh
```

This script:

1. Builds/pushes `user-manager-api` and `timemanager-api` to ECR
2. Runs the one-shot ECS migrate task (`deno task migrate`)
3. Sets desired count to 1 and force-deploys both services

Nx wrappers (build only):

```bash
nx run user-manager-api:docker-build
nx run timemanager-api:docker-build
```

## Deploy web (S3 + CloudFront)

```bash
./infra/aws/scripts/deploy-web.sh
# or: nx run user-manager-web:deploy-web
# DOMAIN from infra/aws/.local.env (or export DOMAIN=…)
```

Builds:

- Flutter web with `--dart-define=AUTH_API_BASE_URL` / `API_BASE_URL`
- `user-manager-web` with `VITE_API_DOMAIN` / `VITE_WEBSITE_DOMAIN`

Then syncs to the Terraform S3 buckets and invalidates CloudFront. SPA fallbacks (`403`/`404` → `/index.html`) are configured in Terraform.

## Remote into an ECS task / live logs

Lists ACTIVE services with running tasks, then either opens an interactive shell (ECS Exec) or tails CloudWatch logs:

```bash
./infra/aws/scripts/ecs-shell.sh
# or: nx run timemanager-aws:ecs-shell
# optional: --shell | --logs
# optional: --service timemanager-api  --command /bin/bash
```

Shell mode requires the [Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html). Terraform enables Exec (`enable_execute_command` + task-role `ssmmessages` policy); after apply, force a new deployment so existing tasks pick it up (`deploy-apis.sh` or `aws ecs update-service … --force-new-deployment`). Logs mode only needs the AWS CLI.

## Smoke checklist

Automated (HTTP + ECS/ALB when AWS CLI is authenticated):

```bash
./infra/aws/scripts/check-health.sh
# or: nx run timemanager-aws:health
# flags: --http-only | --aws-only
# DOMAIN from infra/aws/.local.env
```

Manual:

1. `curl -sS https://auth.<domain>/hello` → `hello`
2. `curl -sS https://auth.<domain>/auth/jwt/jwks.json` → JWKS JSON
3. `curl -sS https://api.<domain>/health` → `{"ok":true}`
4. `curl -sS -X POST https://api.<domain>/graphql -H 'content-type: application/json' -d '{"query":"{__typename}"}'` → `401` without Bearer
5. Open `https://app.<domain>` → sign in → GraphQL calls succeed
6. Open `https://account.<domain>` → SuperTokens cookie session works

## Manual order (CI/CD contract)

Map future pipeline jobs 1:1 to this sequence:

1. **PR** — `nx test` / `flutter analyze` / `deno test` (no deploy)
2. **main** — `terraform plan/apply` (infra changes only when `infra/aws/**` changes)
3. Build/push ECR images (`deploy-apis.sh` steps 1–2)
4. ECS migrate task
5. ECS service update
6. Build/sync static sites + CloudFront invalidation (`deploy-web.sh`)
7. Smoke checks above

### Recommended later CI (not implemented yet)

- GitHub Actions + **OIDC → AWS** (no long-lived access keys)
- Path filters so Flutter-only PRs skip API image builds
- Optional Nx affected / Nx Cloud (still deferred in decisions)

## Local config reference

| App | Mechanism |
|-----|-----------|
| `user-manager-api` | `API_DOMAIN`, `WEBSITE_DOMAIN`, `ALLOWED_ORIGINS`, `PORT`, `SUPERTOKENS_CONNECTION_URI` — see `.env.example` |
| `timemanager-api` | `DATABASE_URL` or `PG*`, `AUTH_API_DOMAIN` — see `.env.example` |
| `user-manager-web` | `VITE_API_DOMAIN`, `VITE_WEBSITE_DOMAIN` |
| Flutter | `--dart-define=AUTH_API_BASE_URL=...` `--dart-define=API_BASE_URL=...` (via `DOMAIN=… nx run timemanager:build-web` or `config/cloud.dart-defines.json`) |

Nx targets: `timemanager:build-web|build-macos|build-ios|build-ipa|build-apk|build-appbundle|…`, `timemanager:serve-cloud`, `user-manager-api:docker-build`, `timemanager-api:docker-build`, `timemanager-aws:plan|apply|up|down|health|deploy-apis|deploy-web`.
