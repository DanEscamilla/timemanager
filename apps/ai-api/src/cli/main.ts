import type { UseCaseSummary } from '../use_cases/registry.ts'
import { createAiApiClient, type AiApiClient } from './client.ts'
import {
  buildInputFromAnswers,
  fieldPromptLabel,
} from './guided.ts'
import { chooseIndex, confirm, readLine } from './prompt.ts'

async function promptFields(
  fields: UseCaseSummary['inputFields'],
): Promise<Record<string, unknown> | null> {
  const answers: Array<string | null> = []
  for (const field of fields) {
    while (true) {
      const raw = await readLine(fieldPromptLabel(field))
      if (raw === null) return null
      try {
        // Validate this field alone before accepting.
        buildInputFromAnswers([field], [raw])
        answers.push(raw)
        break
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.log(`  ${message}`)
      }
    }
  }
  return buildInputFromAnswers(fields, answers)
}

async function listModelsOnce(client: AiApiClient): Promise<'again' | 'quit'> {
  console.log('\nCalling ModelService.ListModels via ai-api…')
  const { provider, models } = await client.listModels()
  console.log(`Provider: ${provider}`)
  console.log(`Models (${models.length}):`)
  for (const model of models) {
    const methods = model.supportedMethods?.length
      ? ` [${model.supportedMethods.join(', ')}]`
      : ''
    const label = model.displayName && model.displayName !== model.id
      ? `${model.id} — ${model.displayName}`
      : model.id
    console.log(`  ${label}${methods}`)
  }

  const again = await confirm('Back to menu?', true)
  return again ? 'again' : 'quit'
}

async function runUseCaseOnce(client: AiApiClient): Promise<'again' | 'quit'> {
  const useCases = await client.listUseCases()
  if (useCases.length === 0) {
    console.log('No use cases registered.')
    return 'quit'
  }

  console.log('\nUse cases:')
  useCases.forEach((uc, i) => {
    console.log(`  ${i + 1}. ${uc.id} — ${uc.description}`)
  })
  console.log('  q. Back')

  const index = await chooseIndex('Select use case', useCases.length)
  if (index === null) return 'again'

  const selected = useCases[index]!
  console.log(`\nRunning ${selected.id}`)
  if (selected.inputFields.length === 0) {
    console.log('(no input fields)')
  }

  const input = await promptFields(selected.inputFields)
  if (input === null) return 'quit'

  const modelRaw = await readLine(
    'Model override (string) — leave blank for provider default [optional]',
  )
  if (modelRaw === null) return 'quit'
  const model = modelRaw.trim() || undefined

  console.log('\nRequest:')
  console.log(JSON.stringify({ input, ...(model ? { model } : {}) }, null, 2))

  const ok = await confirm('Run with this request?', true)
  if (!ok) {
    const again = await confirm('Pick another action?', true)
    return again ? 'again' : 'quit'
  }

  console.log('\nCalling ai-api…')
  const { status, body } = await client.runUseCase(selected.id, input, {
    model,
  })
  console.log(`Status: ${status}`)
  console.log(JSON.stringify(body, null, 2))

  const again = await confirm('Run another?', true)
  return again ? 'again' : 'quit'
}

async function runOnce(client: AiApiClient): Promise<'again' | 'quit'> {
  console.log('\nActions:')
  console.log('  1. List models (ModelService.ListModels)')
  console.log('  2. Run a use case')
  console.log('  q. Quit')

  const index = await chooseIndex('Select action', 2)
  if (index === null) return 'quit'
  if (index === 0) return await listModelsOnce(client)
  return await runUseCaseOnce(client)
}

async function main(): Promise<void> {
  const serviceKey = Deno.env.get('AI_SERVICE_KEY')?.trim()
  if (!serviceKey) {
    console.error('AI_SERVICE_KEY is required (set in apps/ai-api/.env).')
    Deno.exit(1)
  }

  const baseUrl =
    Deno.env.get('AI_API_BASE_URL')?.trim() || 'http://localhost:3004'
  const client = createAiApiClient({ baseUrl, serviceKey })

  console.log(`ai-api CLI → ${baseUrl}`)
  await client.health()

  while (true) {
    const next = await runOnce(client)
    if (next === 'quit') break
  }

  console.log('Bye.')
}

if (import.meta.main) {
  try {
    await main()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(message)
    Deno.exit(1)
  }
}
