import type { Branch, BranchDisposition } from './types'

/**
 * Disposition a freshly-created branch starts with (P1-S3). `pending` means
 * closing it silently deletes the fork topic (absorbs the orphan debt that
 * earlier steps deferred). `kept` is opt-in via the Keep button.
 */
export const DEFAULT_BRANCH_DISPOSITION: BranchDisposition = 'pending'

/** Flip pending ↔ kept (the Keep button toggle). */
export function toggleDisposition(d: BranchDisposition): BranchDisposition {
  return d === 'kept' ? 'pending' : 'kept'
}

/**
 * On branch close, route by disposition:
 *   - pending (default) → delete the fork topic (reuse the existing DataApi
 *     `DELETE /topics/:id` via the passed `deleteForkTopic`).
 *   - kept → do NOT delete; the topic stays in the DB.
 * A compose-state branch (no fork topic yet) deletes nothing.
 *
 * This only DECIDES + CALLS the passed deleter — it does not own the abort
 * (B5) or the branches[] removal, which the close handler does around it.
 */
export function disposeBranchTopicOnClose(branch: Branch, deleteForkTopic: (topicId: string) => void): void {
  if (branch.topic && branch.disposition !== 'kept') {
    deleteForkTopic(branch.topic.id)
  }
}
