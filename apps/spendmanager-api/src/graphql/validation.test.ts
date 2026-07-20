import {
  validateAlertPercent,
  validateAmountCents,
  validateAnchorDate,
  validateBudgetAmountCents,
  validateBudgetName,
  validateCategoryColor,
  validateCategoryName,
  validateCurrency,
  validateIntervalCount,
  validateIntervalUnit,
  validateSpentOn,
  InvalidBudgetError,
  InvalidCategoryError,
  InvalidExpenseError,
} from './validation.ts'

Deno.test('validateCategoryName trims and rejects empty', () => {
  if (validateCategoryName('  Food  ') !== 'Food') {
    throw new Error('expected trim')
  }
  let threw = false
  try {
    validateCategoryName('   ')
  } catch (e) {
    threw = e instanceof InvalidCategoryError
  }
  if (!threw) throw new Error('expected InvalidCategoryError')
})

Deno.test('validateCategoryColor requires hex', () => {
  if (validateCategoryColor('#0f766e') !== '#0F766E') {
    throw new Error('expected uppercase hex')
  }
  let threw = false
  try {
    validateCategoryColor('blue')
  } catch (e) {
    threw = e instanceof InvalidCategoryError
  }
  if (!threw) throw new Error('expected InvalidCategoryError')
})

Deno.test('validateAmountCents requires positive integer', () => {
  if (validateAmountCents(100) !== 100) throw new Error('expected 100')
  for (const bad of [0, -1, 1.5, Number.NaN]) {
    let threw = false
    try {
      validateAmountCents(bad)
    } catch (e) {
      threw = e instanceof InvalidExpenseError
    }
    if (!threw) throw new Error(`expected InvalidExpenseError for ${bad}`)
  }
})

Deno.test('validateCurrency and validateSpentOn', () => {
  if (validateCurrency('usd') !== 'USD') throw new Error('currency')
  if (validateSpentOn('2026-07-20') !== '2026-07-20') {
    throw new Error('spent_on')
  }
  let threw = false
  try {
    validateSpentOn('2026-13-40')
  } catch (e) {
    threw = e instanceof InvalidExpenseError
  }
  if (!threw) throw new Error('expected invalid date')
})

Deno.test('validateBudgetName and amount', () => {
  if (validateBudgetName('  Total  ') !== 'Total') throw new Error('name')
  if (validateBudgetAmountCents(5000) !== 5000) throw new Error('amount')
  let threw = false
  try {
    validateBudgetAmountCents(0)
  } catch (e) {
    threw = e instanceof InvalidBudgetError
  }
  if (!threw) throw new Error('expected InvalidBudgetError')
})

Deno.test('validateInterval and alertPercent', () => {
  if (validateIntervalUnit('Month') !== 'month') throw new Error('unit')
  if (validateIntervalCount(2) !== 2) throw new Error('count')
  if (validateAlertPercent(80) !== 80) throw new Error('alert')
  if (validateAnchorDate('2026-01-15') !== '2026-01-15') {
    throw new Error('anchor')
  }
  for (const bad of [0, 101, 1.5]) {
    let threw = false
    try {
      validateAlertPercent(bad)
    } catch (e) {
      threw = e instanceof InvalidBudgetError
    }
    if (!threw) throw new Error(`expected InvalidBudgetError for ${bad}`)
  }
})
