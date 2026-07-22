import type { SpendingCandidatePayload } from './types.ts'

/**
 * Future bridge into spendmanager (or another ledger).
 * mailbox_kit must not import product GraphQL types; adapters live in apps.
 */
export interface ExpenseSink {
  publish(
    userId: number,
    candidate: SpendingCandidatePayload,
  ): Promise<void>
}

/** No-op sink for local/dev until spendmanager wiring exists. */
export class NoopExpenseSink implements ExpenseSink {
  async publish(
    _userId: number,
    _candidate: SpendingCandidatePayload,
  ): Promise<void> {
    // intentionally empty
  }
}
