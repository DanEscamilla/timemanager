import { assertEquals } from 'jsr:@std/assert@1'
import { SPENDING_CANDIDATE_KIND } from '../types.ts'
import { FIXTURE_RECEIPT_MESSAGES } from '../providers/fixture_provider.ts'
import { SpendingExtractor } from './spending_extractor.ts'
import { ExtractorPipeline } from '../extractor.ts'

Deno.test('SpendingExtractor extracts Amazon fixture', () => {
  const extractor = new SpendingExtractor()
  const msg = FIXTURE_RECEIPT_MESSAGES[0]!
  assertEquals(extractor.canHandle(msg), true)
  const arts = extractor.extract(msg)
  assertEquals(arts.length, 1)
  assertEquals(arts[0]!.kind, SPENDING_CANDIDATE_KIND)
  assertEquals(arts[0]!.payload.amountCents, 4299)
  assertEquals(arts[0]!.payload.currency, 'USD')
  assertEquals(arts[0]!.payload.spentOn, '2026-07-01')
})

Deno.test('SpendingExtractor skips newsletter fixture', () => {
  const extractor = new SpendingExtractor()
  const msg = FIXTURE_RECEIPT_MESSAGES[2]!
  assertEquals(extractor.canHandle(msg), false)
  assertEquals(extractor.extract(msg).length, 0)
})

Deno.test('ExtractorPipeline routes only handling extractors', () => {
  const pipeline = new ExtractorPipeline([new SpendingExtractor()])
  const receipts = pipeline.run(FIXTURE_RECEIPT_MESSAGES[1]!)
  assertEquals(receipts.length, 1)
  assertEquals(receipts[0]!.payload.amountCents, 1850)

  const news = pipeline.run(FIXTURE_RECEIPT_MESSAGES[2]!)
  assertEquals(news.length, 0)
})
