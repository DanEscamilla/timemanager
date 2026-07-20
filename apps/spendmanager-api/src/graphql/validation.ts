export class InvalidCategoryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidCategoryError'
  }
}

export class InvalidExpenseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidExpenseError'
  }
}

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const CURRENCY = /^[A-Z]{3}$/

export function validateCategoryName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) {
    throw new InvalidCategoryError('name is required')
  }
  if (trimmed.length > 255) {
    throw new InvalidCategoryError('name is too long')
  }
  return trimmed
}

export function validateCategoryColor(color: string): string {
  const trimmed = color.trim()
  if (!HEX_COLOR.test(trimmed)) {
    throw new InvalidCategoryError('color must be a hex value like #0F766E')
  }
  return trimmed.toUpperCase()
}

export function validateAmountCents(amountCents: number): number {
  if (!Number.isFinite(amountCents) || !Number.isInteger(amountCents)) {
    throw new InvalidExpenseError('amount_cents must be an integer')
  }
  if (amountCents <= 0) {
    throw new InvalidExpenseError('amount_cents must be positive')
  }
  return amountCents
}

export function validateCurrency(currency: string): string {
  const trimmed = currency.trim().toUpperCase()
  if (!CURRENCY.test(trimmed)) {
    throw new InvalidExpenseError('currency must be a 3-letter ISO code')
  }
  return trimmed
}

export function validateSpentOn(spentOn: string): string {
  const trimmed = spentOn.trim()
  if (!DATE_ONLY.test(trimmed)) {
    throw new InvalidExpenseError('spent_on must be YYYY-MM-DD')
  }
  const d = new Date(`${trimmed}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== trimmed) {
    throw new InvalidExpenseError('spent_on is not a valid date')
  }
  return trimmed
}

export function validateNote(note: string | null | undefined): string | null {
  if (note == null) return null
  const trimmed = note.trim()
  return trimmed.length === 0 ? null : trimmed
}
