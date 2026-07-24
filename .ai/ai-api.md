# AI API

Internal gateway so Deno backends can run hand-coded AI use cases without each app talking to Gemini (or a future self-hosted model) directly.

## Pieces

| Path | Role |
|------|------|
| [`libs/ai_kit`](../libs/ai_kit) | `AiProvider`, Gemini + OpenAI-compatible impls, env factory |
| [`apps/ai-api`](../apps/ai-api) | REST server on `:3004`, service-key auth, use-case registry |

## Run locally

```bash
# ensure apps/ai-api/.env exists (setup copies from .env.example)
# set GEMINI_API_KEY from https://aistudio.google.com/apikey
pnpm ai    # nx serve ai-api
```

```bash
curl -s http://localhost:3004/health

curl -s -H "Authorization: Bearer $AI_SERVICE_KEY" \
  http://localhost:3004/v1/use-cases

curl -s -H "Authorization: Bearer $AI_SERVICE_KEY" \
  http://localhost:3004/v1/models

curl -s -X POST http://localhost:3004/v1/use-cases/summarize_text/run \
  -H "Authorization: Bearer $AI_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"input":{"text":"Long article…","maxSentences":2},"model":"gemini-2.0-flash"}'
```

Auth: `Authorization: Bearer <AI_SERVICE_KEY>` or `X-AI-Service-Key: <AI_SERVICE_KEY>`.

Optional top-level `model` on `POST …/run` overrides the tier / provider default for that request.

## Model tiers

Configure two model IDs on the gateway (provider-agnostic; works with `gemini` or `openai_compatible`):

| Env | Used by |
|-----|---------|
| `AI_MODEL_LOW` | `classify_email_spend_relevance`, `summarize_text` |
| `AI_MODEL_HIGH` | `generate_email_spend_template`, `generate_email_reject_template` |

Resolution order when `model` is omitted: tier env → legacy `GEMINI_MODEL` / `AI_MODEL` (by `AI_PROVIDER`) → provider hardcoded default.

## Interactive CLI

Guided HTTP client for trying use cases against a running gateway (field prompts from each use case’s `inputFields`, plus optional model override). Menu also includes **List models** (`GET /v1/models` → Gemini `ModelService.ListModels` / OpenAI-compatible `/models`):

```bash
pnpm ai          # terminal 1 — serve :3004
pnpm ai:cli      # terminal 2 — nx run ai-api:cli
```

Uses `AI_SERVICE_KEY` and optional `AI_API_BASE_URL` from `apps/ai-api/.env`.

```bash
curl -s -H "Authorization: Bearer $AI_SERVICE_KEY" \
  http://localhost:3004/v1/models
```

## Providers

| `AI_PROVIDER` | Env | Notes |
|---------------|-----|--------|
| `gemini` (default) | `GEMINI_API_KEY`, optional `GEMINI_MODEL`, optional `AI_MODEL_LOW` / `AI_MODEL_HIGH` | Google AI Studio free tier |
| `openai_compatible` | `AI_BASE_URL`, optional `AI_API_KEY` / `AI_MODEL`, optional `AI_MODEL_LOW` / `AI_MODEL_HIGH` | Ollama / vLLM / etc. |

Self-host later: point `AI_PROVIDER=openai_compatible` at your OpenAI-compatible base URL. Use cases do not change. Do not run large models on the tiny Fargate tasks used for product APIs — see [aws-architecture.md](aws-architecture.md).

## Adding a use case

1. Add `apps/ai-api/src/use_cases/<id>.ts` implementing `UseCase` (`inputFields`, `parseInput`, `run`, `modelTier`). Forward `options?.model` into `provider.complete({ model, … })`.
2. Register it in [`apps/ai-api/src/use_cases/registry.ts`](../apps/ai-api/src/use_cases/registry.ts).
3. Call `POST /v1/use-cases/<id>/run` with `{ "input": { … }, "model"?: "…" }`, or exercise it via `pnpm ai:cli`. The server picks `AI_MODEL_LOW` or `AI_MODEL_HIGH` from the use case’s `modelTier` when `model` is omitted.

Shipped use cases:

- `summarize_text` — short text summary (low-tier model)
- `generate_email_spend_template` — structured spending parsing template from a sample email (mailbox-api GraphQL + worker auto-template; high-tier model)
- `generate_email_reject_template` — match-only ignore template from a sample email (high-tier model)
- `classify_email_spend_relevance` — whether an email type is useful for spending extraction (`useful` boolean); worker uses this on unmatched mail before generating a template (low-tier model)

## Non-goals (v1)

- Flutter / browser callers and SuperTokens JWKS
- GraphQL schema
- Usage metering DB
- Streaming responses
- AWS packaging of `ai-api`
