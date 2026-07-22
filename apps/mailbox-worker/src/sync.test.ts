import { assertEquals } from 'jsr:@std/assert@1'
import {
  ExtractorPipeline,
  FixtureMailboxProvider,
  SpendingExtractor,
  filterMessagesByDomain,
} from 'mailbox_kit/mod.ts'

/**
 * Unit-level sync pipeline test without Postgres: provider → domain filter → extractors.
 * Full DB integration is covered by seed + manual worker run.
 */
Deno.test('fixture sync pipeline extracts spending from filtered mail', async () => {
  const provider = new FixtureMailboxProvider()
  const page = await provider.listMessages({ cursor: null, limit: 50 })
  const filtered = filterMessagesByDomain(page.messages, [
    'amazon.com',
    'uber.com',
  ])
  assertEquals(filtered.length, 2)

  const pipeline = new ExtractorPipeline([new SpendingExtractor()])
  const artifacts = filtered.flatMap((m) => pipeline.run(m))
  assertEquals(artifacts.length, 2)
  assertEquals(artifacts.every((a) => a.kind === 'spending.candidate'), true)
})
