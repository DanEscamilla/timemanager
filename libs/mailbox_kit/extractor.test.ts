import { assertEquals } from 'jsr:@std/assert@1'
import { ExtractorPipeline, type Extractor } from './extractor.ts'
import type { EmailMessage, ExtractionArtifact } from './types.ts'

const msg: EmailMessage = {
  id: '1',
  rfcMessageId: '<a@b.com>',
  from: 'a@b.com',
  subject: 'x',
  receivedAt: new Date(),
  textBody: 'hi',
  htmlBody: null,
}

function stub(
  name: string,
  arts: ExtractionArtifact[],
): Extractor {
  return {
    kind: name,
    canHandle: () => true,
    extract: () => arts,
  }
}

Deno.test('ExtractorPipeline firstMatchOnly stops after first artifacts', () => {
  const pipeline = new ExtractorPipeline(
    [
      stub('a', [{ kind: 'a', payload: { n: 1 }, confidence: 0.9 }]),
      stub('b', [{ kind: 'b', payload: { n: 2 }, confidence: 0.5 }]),
    ],
    { firstMatchOnly: true },
  )
  const out = pipeline.run(msg)
  assertEquals(out.length, 1)
  assertEquals(out[0]!.kind, 'a')
})

Deno.test('ExtractorPipeline without firstMatchOnly collects all', () => {
  const pipeline = new ExtractorPipeline([
    stub('a', [{ kind: 'a', payload: {}, confidence: 0.9 }]),
    stub('b', [{ kind: 'b', payload: {}, confidence: 0.5 }]),
  ])
  assertEquals(pipeline.run(msg).length, 2)
})
