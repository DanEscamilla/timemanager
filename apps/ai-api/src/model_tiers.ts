export type ModelTier = 'low' | 'high'

/**
 * Resolve the model id for a use-case tier.
 * Order: AI_MODEL_LOW / AI_MODEL_HIGH → GEMINI_MODEL / AI_MODEL (by provider) → undefined
 * (undefined lets the AiProvider use its hardcoded default).
 */
export function resolveModelForTier(
  tier: ModelTier,
  env: Record<string, string | undefined> = Deno.env.toObject(),
): string | undefined {
  const tierKey = tier === 'low' ? 'AI_MODEL_LOW' : 'AI_MODEL_HIGH'
  const fromTier = env[tierKey]?.trim()
  if (fromTier) return fromTier

  return legacyDefaultModel(env)
}

function legacyDefaultModel(
  env: Record<string, string | undefined>,
): string | undefined {
  const kind = (env.AI_PROVIDER ?? 'gemini').trim().toLowerCase()
  if (
    kind === 'openai_compatible' ||
    kind === 'openai-compatible' ||
    kind === 'openai'
  ) {
    return env.AI_MODEL?.trim() || undefined
  }
  return env.GEMINI_MODEL?.trim() || undefined
}
