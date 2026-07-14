import type { RewardInventory, RewardTransaction } from '../db/types/schema.ts'

export type RewardNudgeKind =
  | 'inventory_available'
  | 'recently_earned'
  | 'unconsumed_stack'

export interface RewardNudge {
  kind: RewardNudgeKind
  title: string
  message: string
  severity: 'info' | 'success'
  definitionId?: number | null
  inventoryId?: number | null
}

/**
 * Build lightweight reward nudges for the Overview surface.
 * Pure — no I/O.
 */
export function buildRewardNudges(input: {
  inventory: Array<
    Pick<RewardInventory, 'id' | 'quantity' | 'reward_definition_id'> & {
      name?: string
    }
  >
  recentEarns: Array<
    Pick<
      RewardTransaction,
      'id' | 'definition_name' | 'quantity' | 'created_at' | 'reward_definition_id'
    >
  >
  now?: Date
}): RewardNudge[] {
  const nudges: RewardNudge[] = []
  const now = input.now ?? new Date()

  const totalQty = input.inventory.reduce((s, i) => s + i.quantity, 0)
  if (totalQty > 0) {
    const top = [...input.inventory].sort((a, b) => b.quantity - a.quantity)[0]
    nudges.push({
      kind: 'inventory_available',
      title: 'Rewards ready',
      message:
        totalQty === 1
          ? 'You have 1 reward waiting to be enjoyed.'
          : `You have ${totalQty} rewards waiting to be enjoyed.`,
      severity: 'info',
      definitionId: top?.reward_definition_id,
      inventoryId: top?.id,
    })
  }

  const dayAgo = now.getTime() - 24 * 60 * 60 * 1000
  const fresh = input.recentEarns.filter((e) => {
    const t = new Date(e.created_at).getTime()
    return t >= dayAgo
  })
  for (const earn of fresh.slice(0, 3)) {
    nudges.push({
      kind: 'recently_earned',
      title: 'Reward earned',
      message: `You earned ${earn.definition_name} ×${earn.quantity}.`,
      severity: 'success',
      definitionId: earn.reward_definition_id,
    })
  }

  const bigStack = input.inventory.find((i) => i.quantity >= 5)
  if (bigStack) {
    nudges.push({
      kind: 'unconsumed_stack',
      title: 'Growing stack',
      message: `${bigStack.name ?? 'A reward'} is stacked ×${bigStack.quantity} — treat yourself?`,
      severity: 'info',
      definitionId: bigStack.reward_definition_id,
      inventoryId: bigStack.id,
    })
  }

  return nudges
}
