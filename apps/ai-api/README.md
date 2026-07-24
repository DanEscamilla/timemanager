# ai-api

Internal AI gateway for backend services. Use cases are registered in code; providers swap via env (`gemini` today, `openai_compatible` for self-host later).

See [`.ai/ai-api.md`](../../.ai/ai-api.md).

```bash
# from repo root
cp apps/ai-api/.env.example apps/ai-api/.env   # set GEMINI_API_KEY + AI_SERVICE_KEY
pnpm ai                                        # nx serve ai-api → :3004
```

```bash
curl -s http://localhost:3004/health
curl -s -H "Authorization: Bearer $AI_SERVICE_KEY" http://localhost:3004/v1/use-cases
curl -s -H "Authorization: Bearer $AI_SERVICE_KEY" http://localhost:3004/v1/models
curl -s -X POST http://localhost:3004/v1/use-cases/summarize_text/run \
  -H "Authorization: Bearer $AI_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"input":{"text":"Hello from the monorepo."},"model":"gemini-2.0-flash"}'
```

Optional top-level `model` overrides the tier / provider default for that request. Without it, the use case’s tier picks `AI_MODEL_LOW` or `AI_MODEL_HIGH` (see `.ai/ai-api.md`).

Interactive guided CLI (server must already be running):

```bash
pnpm ai:cli    # nx run ai-api:cli
```
