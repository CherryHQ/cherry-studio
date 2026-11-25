import type { CherryMessagePart } from '@shared/data/types/message'
import { DISMISSED_NO_RESPONSE_PART_TYPE, type DismissedNoResponsePart } from '@shared/data/types/uiParts'

/** Create the hidden marker for a dismissed synthetic no-response error. */
export function createDismissedNoResponsePart(): DismissedNoResponsePart {
  return {
    type: DISMISSED_NO_RESPONSE_PART_TYPE,
    data: {}
  }
}

/** Whether parts contain a dismissed no-response marker. */
export function hasDismissedNoResponsePart(parts: readonly CherryMessagePart[] | undefined): boolean {
  return parts?.some((part) => part.type === DISMISSED_NO_RESPONSE_PART_TYPE) ?? false
}
