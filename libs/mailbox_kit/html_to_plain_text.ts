/**
 * Convert email HTML (Outlook/table layouts, Latin entities) into readable plain text.
 * Used at sync time for persistence and by extractors for the `html_text` source.
 */
export function htmlToPlainText(html: string | null | undefined): string {
  if (!html) return ''

  let s = html

  // Comments (incl. Outlook <!--[if ...]> … <![endif]-->)
  s = s.replace(/<!--[\s\S]*?-->/g, '')

  // Non-content blocks
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '')
  s = s.replace(/<style[\s\S]*?<\/style>/gi, '')
  s = s.replace(/<head[\s\S]*?<\/head>/gi, '')
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, '')

  // Soft line breaks / block ends → newlines
  s = s.replace(/<br\s*\/?>/gi, '\n')
  s = s.replace(/<\/(p|div|tr|h[1-6]|li|blockquote)\s*>/gi, '\n')
  // Table cells: keep words from adjacent cells separated
  s = s.replace(/<\/td\s*>/gi, ' ')
  s = s.replace(/<\/th\s*>/gi, ' ')

  // Drop remaining tags
  s = s.replace(/<[^>]+>/g, '')

  s = decodeHtmlEntities(s)

  // Normalize whitespace
  s = s
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim())
    .join('\n')
  s = s.replace(/\n{3,}/g, '\n\n')
  return s.trim()
}

/** True when a stored body looks like raw HTML rather than plain text. */
export function looksLikeHtml(value: string): boolean {
  return /^\s*(<!DOCTYPE\b|<html\b|<head\b|<body\b|<div\b|<table\b|<p\b|<br\b|<span\b)/i
    .test(value)
}

/**
 * Prefer genuine plain MIME text; otherwise extract from HTML (incl. HTML
 * duplicated into the text part).
 */
export function resolveTextBody(
  textBody: string | null | undefined,
  htmlBody: string | null | undefined,
): string | null {
  const text = textBody?.trim()
  if (text && !looksLikeHtml(text)) return text

  const fromHtml = htmlToPlainText(htmlBody)
  if (fromHtml) return fromHtml

  if (text) {
    const stripped = htmlToPlainText(text)
    if (stripped) return stripped
  }

  return null
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  // Common Latin accents in MX / ES bank emails
  aacute: 'á',
  eacute: 'é',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  ntilde: 'ñ',
  Aacute: 'Á',
  Eacute: 'É',
  Iacute: 'Í',
  Oacute: 'Ó',
  Uacute: 'Ú',
  Ntilde: 'Ñ',
  uuml: 'ü',
  Uuml: 'Ü',
  iexcl: '¡',
  iquest: '¿',
  copy: '©',
  reg: '®',
  trade: '™',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  laquo: '«',
  raquo: '»',
}

function decodeHtmlEntities(s: string): string {
  return s.replace(
    /&(#x?[0-9a-f]+|[a-z]+);/gi,
    (match, entity: string) => {
      if (entity[0] === '#') {
        const hex = entity[1] === 'x' || entity[1] === 'X'
        const code = hex
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10)
        if (Number.isFinite(code) && code >= 0) {
          try {
            return String.fromCodePoint(code)
          } catch {
            return match
          }
        }
        return match
      }
      return NAMED_ENTITIES[entity] ?? match
    },
  )
}
