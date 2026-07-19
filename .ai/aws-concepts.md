# AWS concepts (in this architecture)

Explanations of core AWS pieces used by [`infra/aws`](../infra/aws/), assuming basic CS knowledge. For layouts and cost comparison, see [`aws-architecture.md`](aws-architecture.md). For deploy steps, see [`deploy-aws.md`](deploy-aws.md).

---

## Route 53

**What it is:** AWS’s DNS service. Same job as “name → address” in any DNS system: clients ask for `api.example.com`, DNS answers with something that gets them to the right entry point (often a load balancer or CDN hostname).

**In this architecture:** A Route 53 hosted zone for the apex domain already exists. Terraform creates records like:

- `auth.<domain>` → ALB (SuperTokens API)
- `api.<domain>` → same ALB (GraphQL)
- (full stack also) `app` / `account` → CloudFront

Route 53 does **not** run the app or terminate TLS. It only steers traffic to the ALB (or CloudFront). Host-based routing *inside* the ALB is what splits `auth` vs `api` to different target groups.

---

## ACM (AWS Certificate Manager)

**What it is:** Issues and renews TLS certificates for AWS-attached endpoints (ALB, CloudFront). You prove domain ownership (usually via DNS records in Route 53); ACM then provides a cert you attach to the load balancer / distribution.

**In this architecture:** The ALB HTTPS listener uses an ACM cert so clients can speak `https://auth…` and `https://api…`. CloudFront (full stack) needs a cert in `us-east-1`. ACM itself is free; you still pay for ALB/CloudFront.

Analogy: Let’s Encrypt / `certbot`, but integrated with AWS listeners and auto-renewal.

---

## AZs (Availability Zones)

**What it is:** Distinct failure domains inside one region (e.g. `us-east-1a`, `us-east-1b`). Same region ≈ low latency between AZs; different AZ ≈ independent power/network failure domains.

**In this architecture:**

- Public/private **subnets** are created in **two AZs**
- ALB **requires** subnets in ≥2 AZs
- RDS subnet group spans those private subnets; staging RDS is still **Single-AZ** (one instance in one AZ) unless Multi-AZ is enabled

“We use two AZs for networking” ≠ “every database is highly available.”

---

## TLS

**What it is:** Transport encryption + server authentication. Client and server negotiate keys; traffic is encrypted on the wire. Certificates bind a public key to a name like `api.example.com`.

**In this architecture (TLS at the edge):**

1. Client ↔ **ALB**: HTTPS (TLS terminated on the ALB using the ACM cert)
2. ALB ↔ **Fargate tasks**: HTTP inside the VPC on ports 3000/3001

That is normal. The internet never sees plaintext; the private hop is inside the VPC. Tasks do not need to manage certs themselves.

HTTP:80 on the ALB only redirects to HTTPS:443.

---

## ALB (Application Load Balancer)

**What it is:** A Layer-7 reverse proxy: understands HTTP/HTTPS, host/path rules, health checks, and spreads traffic across healthy backends.

**In this architecture:** One internet-facing ALB is the front door for both APIs:

| Listener rule | Target |
|---------------|--------|
| Host `auth.<domain>` | ECS auth tasks :3001 (`/hello` health) |
| Host `api.<domain>` | ECS GraphQL tasks :3000 (`/health` health) |
| Else | 404 |

Clients never need the tasks’ IPs. The ALB registers each task’s **ENI IP** (because of `awsvpc`), checks health, and only sends traffic to healthy tasks.

---

## VPC / awsvpc

**VPC:** A private IP network in AWS (like a virtual datacenter LAN): CIDR, subnets, route tables, internet gateway, security groups. This project uses roughly `10.20.0.0/16` with public + private subnets.

**awsvpc:** ECS networking mode where **each task gets its own elastic network interface (ENI)** and private IP in a subnet—like a tiny VM NIC, not “ports on a shared host.”

**In this architecture:**

- ALB in **public** subnets (reachable from the internet)
- RDS in **private** subnets (no public IP)
- Fargate:
  - **Full stack:** private subnets, no public IP → outbound via **NAT**
  - **Simplified:** public subnets + public IP → outbound via **Internet Gateway** (no NAT)

Security groups are the firewall: ALB accepts 80/443 from the world; ECS accepts traffic **only from the ALB SG**; RDS accepts **5432 only from the ECS SG**.

---

## ECS (Elastic Container Service)

**What it is:** AWS’s container orchestrator: cluster + **services** (desired count, deploy strategy) + **task definitions** (image, CPU/memory, env, ports, roles). It keeps N copies of a container running and replaces unhealthy ones.

**In this architecture:** One cluster, two services:

- `user-manager-api` → image from ECR, port 3001, auth target group
- `timemanager-api` → image from ECR, port 3000, api target group

`desired_count` is how many tasks to run (0 until images exist, then 1 for staging). ECS does **not** build images; that is CI / `deploy-apis.sh` + ECR.

---

## ECR (Elastic Container Registry)

**What it is:** A private Docker registry (like a private Docker Hub / GHCR). You `docker push` images; ECS pulls them when starting tasks.

**In this architecture:** Two repos (auth + api). `deploy-apis.sh` builds, tags, pushes, then tells ECS to deploy. Tasks need a network path to ECR (NAT in full stack, or public IP + IGW in simplified).

---

## Multi-AZ HA

**What it is:** Running redundant copies across AZs so one AZ failure does not take the whole system down.

**In this architecture (honest picture):**

| Piece | Multi-AZ HA today? |
|-------|--------------------|
| ALB | Yes — AWS spreads it across the subnets you give it (≥2 AZs) |
| Subnets | Laid out in 2 AZs |
| Fargate `desired_count = 1` | **No** — one task; if its AZ dies, that service is down until ECS places another |
| RDS Single-AZ staging | **No** — standby in another AZ only if Multi-AZ is enabled (~2× cost) |
| NAT (full stack) | **No** — one NAT in one AZ (cheap staging, not HA) |

“Subnets in two AZs” is **preparation** for HA; **multi-AZ HA** means active redundancy (extra tasks, Multi-AZ RDS, NAT per AZ, etc.).

---

## IAM and logs

### CloudWatch Logs

**What it is:** Central log storage/query for AWS. ECS tasks stream stdout/stderr to log groups (retention ~14 days here). Used for ops/debug: crashes, deploy failures, app logs.

Not end-user authentication—just logging infrastructure.

### IAM (Identity and Access Management)

**What it is:** AWS’s **control-plane** authorization: which **AWS principals** (roles, users) may call which **AWS APIs** on which resources.

Examples of IAM questions:

- May this ECS task **pull** from ECR?
- May the execution role **read** Secrets Manager?
- May a laptop user / CI role **run** `terraform apply` or `ecs update-service`?

### Why IAM if SuperTokens already handles auth?

**SuperTokens and IAM are different layers:**

| | SuperTokens (the app) | IAM (AWS) |
|--|----------------------|-----------|
| Who | End users (people using Flutter) | AWS identities (roles, deploy users) |
| What | Login, JWT/session for **your** GraphQL/API | Permission to touch **AWS** APIs/resources |
| Where | `user-manager-api` / JWKS / Bearer on GraphQL | Attached to ECS roles, AWS account, CI OIDC later |

Analogy: SuperTokens is the app’s login system. IAM is like OS users/sudo **for cloud APIs**—who can open the vault (Secrets Manager), pull the container image, write logs. End users never “log in with IAM” to use the calendar app.

You need both: SuperTokens for product auth; IAM so Fargate/ECS can run without baking long-lived AWS keys into images.

In Terraform: an **execution role** (pull image, fetch secrets, write logs) and a **task role** (what the app process may call as itself). Containers assume those roles via the ECS agent.

---

## Fargate task

**What it is:** One running unit of work from a **task definition**: “run this container image with this CPU/memory, these env/secrets, on this network.”

**Fargate** = serverless compute for that task. You do not manage EC2 VMs; AWS places the container and you pay for vCPU × memory × time.

**In this architecture, one auth task roughly means:**

- Pull `…/user-manager-api:tag` from ECR
- 256 CPU units (0.25 vCPU) / 512 MB RAM
- ENI in a subnet (`awsvpc`), security group = ECS SG
- Env: `API_DOMAIN`, `SUPERTOKENS_CONNECTION_URI`, …
- Secrets injected from Secrets Manager
- Listen on 3001; ALB target group points at this task’s IP
- Logs → CloudWatch

An **ECS service** keeps the desired number of such tasks running and registers them with the ALB. A one-off **migrate** task is the same idea without staying attached as a long-lived service: run migrations, exit.

---

## How they chain on one GraphQL request

```text
Flutter
  → DNS (Route 53): api.example.com
  → TLS to ALB (ACM cert)
  → ALB host rule → GraphQL target group
  → Fargate task ENI (awsvpc in VPC subnet)
  → timemanager-api verifies JWT (SuperTokens/JWKS via auth hostname)
  → RDS in private subnet (SG: ECS only)
```

IAM, ECR, and logs sit **around** that path (deploy, pull, permissions, observability), not in the user’s login cookie/JWT path.

---

## Related docs

- [`aws-architecture.md`](aws-architecture.md) — full vs simplified layouts, comparison, cost
- [`deploy-aws.md`](deploy-aws.md) — Terraform, deploy scripts, smoke checks
- [`architecture.md`](architecture.md) — local monorepo data flow
