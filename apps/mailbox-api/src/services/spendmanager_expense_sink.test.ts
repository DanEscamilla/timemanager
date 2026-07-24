import { assertEquals, assertRejects } from 'jsr:@std/assert@1'
import {
  SpendmanagerSinkError,
  publishExpenseToSpendmanager,
} from './spendmanager_expense_sink.ts'

Deno.test('publishExpenseToSpendmanager posts GraphQL mutation', async () => {
  let seenUrl = ''
  let seenAuth = ''
  let seenBody: unknown

  const result = await publishExpenseToSpendmanager(
    {
      amountCents: 1299,
      currency: 'USD',
      spentOn: '2026-07-01',
      merchant: 'Amazon',
      note: null,
      sourceSubject: 'Receipt',
      sourceFrom: 'a@amazon.com',
    },
    3,
    'Bearer test-token',
    {
      baseUrl: 'http://spend.test',
      fetchImpl: (input, init) => {
        seenUrl = String(input)
        seenAuth = (init?.headers as Record<string, string>).Authorization
        seenBody = JSON.parse(String(init?.body))
        return Promise.resolve(
          new Response(JSON.stringify({ data: { createExpense: { id: 42 } } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      },
    },
  )

  assertEquals(result.expenseId, 42)
  assertEquals(seenUrl, 'http://spend.test/graphql')
  assertEquals(seenAuth, 'Bearer test-token')
  const vars = (seenBody as { variables: { input: Record<string, unknown> } })
    .variables.input
  assertEquals(vars.categoryId, 3)
  assertEquals(vars.amountCents, 1299)
  assertEquals(vars.note, 'Amazon — Receipt')
})

Deno.test('publishExpenseToSpendmanager requires bearer', async () => {
  await assertRejects(
    () =>
      publishExpenseToSpendmanager(
        {
          amountCents: 1,
          currency: 'USD',
          spentOn: '2026-07-01',
          merchant: null,
          note: null,
          sourceSubject: '',
          sourceFrom: '',
        },
        1,
        '',
      ),
    SpendmanagerSinkError,
  )
})
