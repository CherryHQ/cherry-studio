import { isSendMessageKeyPressed } from '@renderer/utils/input'
import type { KeyboardEvent } from 'react'

/**
 * THE single keyboard-submit handler shared by BOTH branch composers — the
 * initial-ask `BranchComposer` and the conversation `BranchFollowUpComposer`.
 * One source of truth so their Enter/Shift+Enter/IME behaviour can never drift
 * (P1-S2c B3 unification).
 *
 * Behaviour:
 *   - Enter (no modifier, NOT IME-composing) → `submit()`.
 *   - Shift/Ctrl/etc.+Enter → falls through → the textarea inserts a newline.
 *   - Enter while an IME is composing (`nativeEvent.isComposing`) → never submit
 *     (Enter is selecting a candidate).
 *
 * `forceEnterToSend=true` on the shared `isSendMessageKeyPressed` helper makes
 * this Enter-to-send regardless of the user's global send-key preference — the
 * quick branch boxes always send on Enter, while the main Inputbar keeps
 * following the global setting (it calls the 2-arg form).
 *
 * Empty/whitespace validation is intentionally NOT here — each composer's own
 * `submit()` keeps its non-empty guard (and its draft-clear), so this stays a
 * pure "did the user press the submit key?" decision.
 */
export function handleBranchComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>, submit: () => void): void {
  if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
  if (isSendMessageKeyPressed(event, 'Enter', true)) {
    event.preventDefault()
    submit()
  }
}
