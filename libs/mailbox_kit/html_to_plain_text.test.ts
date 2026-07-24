import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import {
  htmlToPlainText,
  looksLikeHtml,
  resolveTextBody,
} from './html_to_plain_text.ts'

const FIXTURE_DIR = new URL('./testdata/', import.meta.url)

async function readFixture(name: string): Promise<string> {
  return await Deno.readTextFile(new URL(name, FIXTURE_DIR))
}

Deno.test('htmlToPlainText: compra fixture decodes accents and keeps amount', async () => {
  const html = await readFixture('santander_compra.html')
  const text = htmlToPlainText(html)

  assertStringIncludes(text, 'tarjeta de débito')
  assertStringIncludes(text, 'terminación **1071')
  assertStringIncludes(text, 'un monto de $358.01 MXN')
  assertStringIncludes(text, 'Santander México')
  // style / comments / tags gone
  assertEquals(text.includes('<'), false)
  assertEquals(text.includes('font-family'), false)
  assertEquals(text.includes('Outlook only'), false)
})

Deno.test('htmlToPlainText: SPEI fixture supports template-style regexes', async () => {
  const html = await readFixture('santander_spei.html')
  const text = htmlToPlainText(html)

  assertStringIncludes(text, 'ABONO vía SPEI')
  assertStringIncludes(text, 'un abono por $2,500.00 MXN')
  assertStringIncludes(text, 'El depósito ya se encuentra disponible')

  const amount = text.match(/abono por\s+\$([0-9,.]+)\s+MXN/i)?.[1]
  assertEquals(amount, '2,500.00')

  const concept = text.match(/Concepto de pago:\s*([^\n\r]+)/i)?.[1]?.trim()
  assertEquals(concept, 'rentukii')
})

Deno.test('htmlToPlainText: marketing fixture strips style and entities', async () => {
  const html = await readFixture('santander_marketing.html')
  const text = htmlToPlainText(html)

  assertStringIncludes(text, 'Haz rendir más tus compras este mes')
  assertStringIncludes(text, 'Obtén hasta 20% de cashback')
  assertStringIncludes(text, 'Consulta términos y condiciones.')
  assertEquals(text.includes('display: none'), false)
  assertEquals(text.includes('&nbsp;'), false)
})

Deno.test('htmlToPlainText: numeric and basic entities', () => {
  assertEquals(
    htmlToPlainText('<p>Hi&#39;s &amp; bye&#x21;</p>'),
    "Hi's & bye!",
  )
})

Deno.test('htmlToPlainText: empty / null', () => {
  assertEquals(htmlToPlainText(null), '')
  assertEquals(htmlToPlainText(''), '')
  assertEquals(htmlToPlainText('   '), '')
})

Deno.test('looksLikeHtml detects common email HTML prefixes', () => {
  assertEquals(looksLikeHtml('<!DOCTYPE html><html>'), true)
  assertEquals(looksLikeHtml('  <table><tr><td>x</td></tr></table>'), true)
  assertEquals(looksLikeHtml('Plain total $12'), false)
})

Deno.test('resolveTextBody prefers plain MIME over HTML', () => {
  assertEquals(
    resolveTextBody('Plain total $12', '<b>HTML $99</b>'),
    'Plain total $12',
  )
})

Deno.test('resolveTextBody extracts when plain missing', async () => {
  const html = await readFixture('santander_compra.html')
  const text = resolveTextBody(null, html)
  assertStringIncludes(text ?? '', 'un monto de $358.01 MXN')
})

Deno.test('resolveTextBody strips HTML duplicated into textBody', async () => {
  const html = await readFixture('santander_compra.html')
  const text = resolveTextBody(html, html)
  assertStringIncludes(text ?? '', 'tarjeta de débito')
})
