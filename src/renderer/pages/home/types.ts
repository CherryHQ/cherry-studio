// Defined in the composer layer; re-exported here for page-side consumers so the
// composer doesn't import upward into `pages/`.
import type { AddNewTopicPayload } from '@renderer/components/composer/variants/shared/composerProviderActions'

export type { AddNewTopicPayload }

/**
 * Page-level "new topic" payload for the post-delete replacement path. Extends the composer payload
 * with `excludeReuseTopicId`, which is a HomePage delete-replacement policy — not part of the public
 * composer action contract, so it stays out of {@link AddNewTopicPayload}.
 */
export interface AddNewTopicWithReusePayload extends AddNewTopicPayload {
  /**
   * Id of a topic being replaced (post-delete): excluded from empty-topic reuse so a stale candidate
   * list can't reactivate the just-deleted topic instead of creating a fresh one.
   */
  excludeReuseTopicId?: string
}
