import { assertEquals, assertThrows } from 'jsr:@std/assert@1'
import type { UseCaseInputField } from '../use_cases/types.ts'
import { buildInputFromAnswers, fieldPromptLabel } from './guided.ts'

const fields: UseCaseInputField[] = [
  {
    name: 'text',
    description: 'Plain text to summarize',
    type: 'string',
    required: true,
  },
  {
    name: 'maxSentences',
    description: 'Maximum sentence count hint',
    type: 'number',
    required: false,
    default: 2,
  },
  {
    name: 'verbose',
    description: 'Include debug notes',
    type: 'boolean',
    required: false,
  },
]

Deno.test('buildInputFromAnswers maps typed values', () => {
  assertEquals(
    buildInputFromAnswers(fields, ['Hello world', '3', 'true']),
    { text: 'Hello world', maxSentences: 3, verbose: true },
  )
})

Deno.test('buildInputFromAnswers applies default for blank optional', () => {
  assertEquals(
    buildInputFromAnswers(fields, ['Hello', '', '']),
    { text: 'Hello', maxSentences: 2 },
  )
})

Deno.test('buildInputFromAnswers omits optional without default when blank', () => {
  assertEquals(
    buildInputFromAnswers(
      [
        fields[0]!,
        {
          name: 'tag',
          description: 'optional tag',
          type: 'string',
          required: false,
        },
      ],
      ['Hello', ''],
    ),
    { text: 'Hello' },
  )
})

Deno.test('buildInputFromAnswers rejects blank required field', () => {
  assertThrows(
    () => buildInputFromAnswers(fields, ['', '2', '']),
    Error,
    'required',
  )
})

Deno.test('buildInputFromAnswers rejects invalid number', () => {
  assertThrows(
    () => buildInputFromAnswers(fields, ['Hello', 'nope', '']),
    Error,
    'number',
  )
})

Deno.test('fieldPromptLabel includes type and default', () => {
  const label = fieldPromptLabel(fields[1]!)
  assertEquals(label.includes('maxSentences'), true)
  assertEquals(label.includes('number'), true)
  assertEquals(label.includes('default: 2'), true)
})
