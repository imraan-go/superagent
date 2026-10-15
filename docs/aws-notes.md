# AWS deployment notes

**Documentation only.** Nothing in this repository provisions AWS resources, and no deployment has
been performed. A public deployment needs the owner's explicit approval first.

## Target shape

| Component | AWS service | Notes |
|---|---|---|
| web | ECS Fargate service behind an ALB (HTTPS, ACM cert) | Only public entry point. Proxies `/api/*` to the API over the private network. |
| api | ECS Fargate service, private subnets | `API_HOST=0.0.0.0` inside the task; reachable only from the web service's security group |
| worker | ECS Fargate service, private subnets, no inbound | Egress to Gateway, Composio, E2B and Temporal Cloud via NAT |
| Postgres | RDS for PostgreSQL 17, Multi-AZ, encrypted, private | `DATABASE_URL` from Secrets Manager; TLS required |
| Artifacts | S3 bucket, Block Public Access, SSE-KMS, lifecycle rule = `TASK_RETENTION_DAYS` | Worker/API task role scoped to the bucket. No MinIO in AWS. |
| Temporal | **Temporal Cloud** (`TEMPORAL_MODE=cloud`) | API key or mTLS from Secrets Manager; namespace retention ≤ 7 days |
| Secrets | Secrets Manager, injected per container | Each service gets only the secrets it uses (table below) |
| Logs | CloudWatch Logs, 7-day retention | The app logs redacted JSON to stdout |

## Secrets per service

| Secret | web | api | worker |
|---|---|---|---|
| `DATABASE_URL` | – | ✓ | ✓ |
| `BETTER_AUTH_SECRET` | – | ✓ | – |
| `S3_*` (or task role) | – | ✓ | ✓ |
| `COMPOSIO_API_KEY` | – | ✓ (connect/verify/disconnect) | ✓ (execute) |
| `AI_GATEWAY_API_KEY` | – | – | ✓ |
| `E2B_API_KEY` | – | – | ✓ |
| `TEMPORAL_API_KEY` / mTLS | – | – | ✓ |

The web container needs no secrets. `API_INTERNAL_URL` is a build argument because Next resolves
rewrites at build time.

## Production settings

- `APP_ENV=production`. The dev seed refuses to run, and cookies become `Secure`.
- `ALLOW_SIGNUP=false` until you intend to open registration.
- `WEB_ORIGIN` is the public HTTPS origin. The API's Origin check and Better Auth trusted origins use it.
- Run `pnpm db:migrate` as a one-off ECS task before rolling out a new version.
- Composio: use your own OAuth apps (`COMPOSIO_AUTH_CONFIG_*`). Google restricted scopes need
  verification and CASA before public Gmail use.
- Never expose the Temporal UI, RDS, S3 or E2B/CDP endpoints publicly.

## Not covered yet

- Infrastructure as code (Terraform or CDK) and a CI/CD pipeline.
- Slimmer production images (`pnpm deploy --prod`, compiled JS instead of `tsx`).
- A WAF and bot protection on the ALB, plus account-level rate limits beyond the in-process
  limiters, which are per instance.
- Backups and restore drills for RDS, and an S3 versioning policy matched to the retention promises.
