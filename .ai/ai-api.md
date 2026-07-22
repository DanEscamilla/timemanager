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

curl -s -X POST http://localhost:3004/v1/use-cases/summarize_text/run \
  -H "Authorization: Bearer $AI_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"input":{"text":"Long article…","maxSentences":2},"model":"gemini-2.0-flash"}'
```

Auth: `Authorization: Bearer <AI_SERVICE_KEY>` or `X-AI-Service-Key: <AI_SERVICE_KEY>`.

Optional top-level `model` on `POST …/run` overrides the provider default for that request (omit to use `GEMINI_MODEL` / `AI_MODEL`).

## Interactive CLI

Guided HTTP client for trying use cases against a running gateway (field prompts from each use case’s `inputFields`, plus optional model override):

```bash
pnpm ai          # terminal 1 — serve :3004
pnpm ai:cli      # terminal 2 — nx run ai-api:cli
```

Uses `AI_SERVICE_KEY` and optional `AI_API_BASE_URL` from `apps/ai-api/.env`.

## Providers

| `AI_PROVIDER` | Env | Notes |
|---------------|-----|--------|
| `gemini` (default) | `GEMINI_API_KEY`, optional `GEMINI_MODEL` | Google AI Studio free tier |
| `openai_compatible` | `AI_BASE_URL`, optional `AI_API_KEY` / `AI_MODEL` | Ollama / vLLM / etc. |

Self-host later: point `AI_PROVIDER=openai_compatible` at your OpenAI-compatible base URL. Use cases do not change. Do not run large models on the tiny Fargate tasks used for product APIs — see [aws-architecture.md](aws-architecture.md).

## Adding a use case

1. Add `apps/ai-api/src/use_cases/<id>.ts` implementing `UseCase` (`inputFields`, `parseInput`, `run`). Forward `options?.model` into `provider.complete({ model, … })`.
2. Register it in [`apps/ai-api/src/use_cases/registry.ts`](../apps/ai-api/src/use_cases/registry.ts).
3. Call `POST /v1/use-cases/<id>/run` with `{ "input": { … }, "model"?: "…" }`, or exercise it via `pnpm ai:cli`.

Example use case shipped: `summarize_text`.

## Non-goals (v1)

- Flutter / browser callers and SuperTokens JWKS
- GraphQL schema
- Usage metering DB
- Streaming responses
- AWS packaging of `ai-api`
