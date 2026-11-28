import { IpcError } from '@shared/ipc/errors/IpcError'
import { knowledgeErrorCodes } from '@shared/ipc/errors/knowledge'

export interface KnowledgeCapacityDetails {
  requested: number
  active: number
  remaining: number
  limit: number
  kind: 'batch_too_large' | 'no_slots'
}

const isCapacityDetails = (value: unknown): value is KnowledgeCapacityDetails => {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const details = value as Record<string, unknown>
  return (
    typeof details.requested === 'number' &&
    typeof details.active === 'number' &&
    typeof details.remaining === 'number' &&
    typeof details.limit === 'number' &&
    (details.kind === 'batch_too_large' || details.kind === 'no_slots')
  )
}

/**
 * Extract structured capacity data from a failed `knowledge.add_items` call.
 * The main handler surfaces capacity rejections as `KNOWLEDGE_CAPACITY_EXCEEDED`
 * with `{ details: { capacity } }` in `IpcError.data` (see
 * `src/main/ipc/handlers/knowledge.ts`); older builds flatten to INTERNAL with
 * only the English message, in which case this returns undefined and callers
 * fall back to the raw message.
 */
export const getKnowledgeCapacityDetails = (error: unknown): KnowledgeCapacityDetails | undefined => {
  if (error instanceof IpcError && error.code === knowledgeErrorCodes.CAPACITY_EXCEEDED) {
    const data = error.data as { details?: { capacity?: unknown } } | undefined
    if (data && isCapacityDetails(data.details?.capacity)) {
      return data.details.capacity
    }
  }
  // Direct DataApiError shape (unit tests, future transports).
  if (typeof error === 'object' && error !== null && 'details' in error) {
    const details = (error as { details?: { capacity?: unknown } }).details
    if (isCapacityDetails(details?.capacity)) {
      return details.capacity
    }
  }
  return undefined
}

type CapacityTranslator = (key: string, options?: Record<string, unknown>) => string

/**
 * Localized capacity rejection: `prefix` is the dialog's submit error title
 * (`knowledge.data_source.add_dialog.submit.error`), followed by the structured
 * capacity explanation. Falls back to null when the error carries no capacity
 * data so callers can use the generic formatter.
 */
export const formatKnowledgeCapacityError = (error: unknown, t: CapacityTranslator, prefix: string): string | null => {
  const capacity = getKnowledgeCapacityDetails(error)
  if (!capacity) {
    return null
  }
  if (capacity.kind === 'batch_too_large') {
    return `${prefix}: ${t('knowledge.data_source.add_dialog.capacity.batch_too_large', {
      count: capacity.requested,
      limit: capacity.limit
    })}`
  }
  return `${prefix}: ${t('knowledge.data_source.add_dialog.capacity.no_slots', {
    active: capacity.active,
    remaining: capacity.remaining,
    requested: capacity.requested
  })}`
}
