import type { SelectionActionItem } from '@shared/data/preference/preferenceTypes'

/**
 * Per-invocation payload for the pooled selection action window.
 * `invocationId` is runtime-only and is never written back to preferences.
 */
export type SelectionActionInvocation = SelectionActionItem & {
  invocationId: string
}
