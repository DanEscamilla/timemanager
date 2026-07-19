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
terraform apply -var='project=timemanager' -var='aws_region=us-east-1'
```

Set the `backend "s3"` bucket in [`infra/aws/versions.tf`](../infra/aws/versions.tf) to the bootstrap `state_bucket` output (locking uses `use_lockfile`; the bootstrap DynamoDB table is optional/legacy), then:

```bash
cd infra/aws
terraform init -migrate-state
```

## Configure and apply infrastructure

```bash
cd infra/aws
cp terraform.tfvars.example terraform.tfvars
# edit domain_name, hosted_zone_id, oauth_secrets, etc.
terraform plan
terraform apply
```

First apply creates networking, RDS, ECR, ALB, CloudFront, Secrets Manager, and ECS services with **`desired_count = 0`** until images exist.

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
export DOMAIN=example.com
./infra/aws/scripts/deploy-web.sh
# or: nx run user-manager-web:deploy-web   # same script; requires DOMAIN
```

Builds:

- Flutter web with `--dart-define=AUTH_API_BASE_URL` / `API_BASE_URL`
- `user-manager-web` with `VITE_API_DOMAIN` / `VITE_WEBSITE_DOMAIN`

Then syncs to the Terraform S3 buckets and invalidates CloudFront. SPA fallbacks (`403`/`404` → `/index.html`) are configured in Terraform.

## Smoke checklist

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

Nx targets: `timemanager:build-web|build-macos|build-ios|build-ipa|build-apk|build-appbundle|…`, `timemanager:serve-cloud`, `user-manager-api:docker-build`, `timemanager-api:docker-build`, `timemanager-aws:plan|apply`.
