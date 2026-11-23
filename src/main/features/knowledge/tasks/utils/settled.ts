import type { AiFailureReason } from '@cherrystudio/remote-protocol/failure'
import { jobService } from '@data/services/JobService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import type { JobSettledEvent } from '@main/core/job/types'
import type { LoggerService } from '@main/core/logger/LoggerService'
import { trackMainProductEvent } from '@main/services/productAnalytics'
import { toExecutionFailure } from '@shared/ai/executionFailure'
import { isDataApiNotFoundError } from '@shared/data/api/errors'
import {
  KNOWLEDGE_ITEM_ERROR_EMPTY_INDEXABLE_TEXT,
  KNOWLEDGE_ITEM_ERROR_INDEXING_INTERRUPTED
} from '@shared/data/types/knowledge'
import type { FeatureErrorReason } from '@shared/ipc/schemas/analytics'

/** Run time of a settled job; the terminal row is written before its settle hook runs. */
export function settledJobDurationMs(jobId: string): number | undefined {
  let job: ReturnType<typeof jobService.getById>
  try {
    job = jobService.getById(jobId)
  } catch {
    return undefined
  }
  if (!job?.startedAt || !job.finishedAt) return undefined
  const durationMs = Date.parse(job.finishedAt) - Date.parse(job.startedAt)
  return Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : undefined
}

const UNSUPPORTED_FORMAT = /^Unsupported knowledge (file|item) type/
const INVALID_FORMAT =
  /^(anydoc conversion produced no text|Failed to read epub chapters|Failed to parse Drafts export)/
// `Web fetch failed after fallback` wraps a fetch that failed on every provider (it can embed e.g. a 404).
const URL_UNREACHABLE =
  /^(Invalid knowledge url|Knowledge web fetch|Knowledge URL returned empty markdown|jina request failed|Web fetch failed after fallback)/

/** A settled job keeps only its error message, so the kind is read from it; the text itself never leaves. */
function itemFailureReason(message: string): FeatureErrorReason | AiFailureReason {
  if (message === KNOWLEDGE_ITEM_ERROR_EMPTY_INDEXABLE_TEXT) return 'empty_indexable_text'
  if (UNSUPPORTED_FORMAT.test(message)) return 'unsupported_format'
  if (INVALID_FORMAT.test(message)) return 'invalid_format'
  if (URL_UNREACHABLE.test(message)) return 'url_unreachable'
  // Embedding calls fail like any model call (auth, quota, network, …).
  const reason = toExecutionFailure({ name: null, message, stack: null }).failure.reasonCode
  return reason === 'unknown' ? 'other' : reason
}

export async function markKnowledgeItemFailedOnSettled(
  event: JobSettledEvent<{ itemId: string }>,
  logger: LoggerService,
  logMessage: string
): Promise<void> {
  if (event.status === 'completed') return

  const { itemId } = event.input

  // A cancelled indexing job for a non-deleting item means it was aborted by an
  // app quit / restart (knowledge has no per-item user cancel), so store the
  // localized `indexing_interrupted` code (the UI maps it to a "reindex to
  // finish" message) instead of the raw internal abort string.
  const reason =
    event.status === 'cancelled'
      ? KNOWLEDGE_ITEM_ERROR_INDEXING_INTERRUPTED
      : event.error?.message?.trim() || `Job ${event.status}`
  try {
    const item = knowledgeItemService.getById(itemId)
    if (item.status === 'deleting') return

    knowledgeItemService.updateStatus(itemId, 'failed', { error: reason })
    const durationMs = settledJobDurationMs(event.jobId)
    trackMainProductEvent({
      event: 'feature_used',
      feature: 'knowledge',
      action: 'item_processed',
      target: item.type,
      status: event.status === 'cancelled' ? 'cancelled' : 'error',
      errorReason: event.status === 'cancelled' ? 'indexing_interrupted' : itemFailureReason(reason),
      ...(durationMs !== undefined && { durationMs })
    })
  } catch (error) {
    if (isDataApiNotFoundError(error)) return
    logger.error(logMessage, error instanceof Error ? error : new Error(String(error)), {
      jobId: event.jobId,
      itemId
    })
  }
}
