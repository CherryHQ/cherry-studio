import type { UniqueModelId } from '../data/types/model'

declare const attemptIdBrand: unique symbol
declare const slotKeyBrand: unique symbol

export type AttemptId = number & { readonly [attemptIdBrand]: true }
export type SlotKey = string & { readonly [slotKeyBrand]: true }

export interface AttemptDescriptor {
  attemptId: AttemptId
  executionId: UniqueModelId
  anchorMessageId: string | null
  topicId: string
}

export function toAttemptId(value: number): AttemptId {
  return value as AttemptId
}

export function slotKey(descriptor: Pick<AttemptDescriptor, 'executionId' | 'anchorMessageId'>): SlotKey {
  return `${descriptor.executionId}\0${descriptor.anchorMessageId ?? ''}` as SlotKey
}
