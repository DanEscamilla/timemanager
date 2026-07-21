import type { PushSender } from 'deno_api_kit/push/mod.ts'
import { NoOpPushSender } from 'deno_api_kit/push/mod.ts'

let pushSender: PushSender = new NoOpPushSender()

export function setPushSender(sender: PushSender): void {
  pushSender = sender
}

export function getPushSender(): PushSender {
  return pushSender
}
