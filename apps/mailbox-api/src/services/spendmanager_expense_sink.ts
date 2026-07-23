import { env as readEnv } from 'deno_api_kit/db/env.ts'
import type { SpendingCandidatePayload } from 'mailbox_kit/mod.ts'

export class SpendmanagerSinkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SpendmanagerSinkError'
  }
}

export type PublishExpenseResult = {
  expenseId: number
}

/**
 * Publish an accepted spending candidate to spendmanager-api via GraphQL,
 * forwarding the caller's SuperTokens Bearer JWT.
 */
export async function publishExpenseToSpendmanager(
  candidate: SpendingCandidatePayload,
  categoryId: number,
  authorizationHeader: string,
  options?: {
    baseUrl?: string
    fetchImpl?: typeof fetch
  },
): Promise<PublishExpenseResult> {
  if (!authorizationHeader?.startsWith('Bearer ')) {
    throw new SpendmanagerSinkError('missing Bearer authorization')
  }

  const baseUrl = (options?.baseUrl ??
    readEnv('SPENDMANAGER_API_BASE_URL') ??
    'http://localhost:3002').replace(/\/$/, '')

  const note = candidate.note?.trim() ||
    [candidate.merchant, candidate.sourceSubject].filter(Boolean).join(' — ') ||
    null

  const query = `
    mutation CreateExpense($input: CreateExpenseInputInput!) {
      createExpense(args: { input: $input }) {
        id
      }
    }
  `

  const fetchImpl = options?.fetchImpl ?? fetch
  const res = await fetchImpl(`${baseUrl}/graphql`, {
    method: 'POST',
    headers: {
      Authorization: authorizationHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      variables: {
        input: {
          categoryId,
          amountCents: candidate.amountCents,
          spentOn: candidate.spentOn,
          currency: candidate.currency,
          note,
        },
      },
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new SpendmanagerSinkError(
      `spendmanager HTTP ${res.status}: ${text.slice(0, 300)}`,
    )
  }

  const body = await res.json() as {
    data?: { createExpense?: { id: number } }
    errors?: { message: string }[]
  }

  if (body.errors?.length) {
    throw new SpendmanagerSinkError(
      body.errors.map((e) => e.message).join('; '),
    )
  }

  const id = body.data?.createExpense?.id
  if (typeof id !== 'number') {
    throw new SpendmanagerSinkError('spendmanager response missing expense id')
  }
  return { expenseId: id }
}
