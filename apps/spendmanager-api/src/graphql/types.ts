export interface CreateCategoryInput {
  name: string
  color: string
}

export interface UpdateCategoryInput {
  name?: string
  color?: string
}

export interface CreateExpenseInput {
  categoryId: number
  amountCents: number
  spentOn: string
  currency?: string
  note?: string | null
}

export interface UpdateExpenseInput {
  categoryId?: number
  amountCents?: number
  spentOn?: string
  currency?: string
  note?: string | null
}
