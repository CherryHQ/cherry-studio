// Defined in the composer layer; re-exported here for page-side consumers so the
// composer doesn't import upward into `pages/`.
import type { AddNewTopicPayload } from '@renderer/components/composer/variants/shared/composerProviderActions'

export type { AddNewTopicPayload }

/** Page-only policy used when replacing a just-deleted topic. */
export interface AddNewTopicWithReusePayload extends AddNewTopicPayload {
  excludeReuseTopicId?: string
}
