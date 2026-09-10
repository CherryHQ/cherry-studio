/** Keyboard relay between a webview guest and its host window. */

import { getShortcutBindingFromKeyboardEvent, isValidShortcut, type KeyboardEventLike } from './shortcut'

/** `sendToHost` channel the shared webview preload uses to reach its host window. */
export const WEBVIEW_KEYDOWN_CHANNEL = 'webview:keydown'

/** Keyboard data forwarded from a webview guest, shaped for `new KeyboardEvent()`. */
export type WebviewKeyPayload = {
  key: string
  code: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
  repeat: boolean
  isTrusted: boolean
}

// The host owns find/print/save inside webviews, so the guest page must not also
// run the browser default for them.
const HOST_OWNED_KEYS = new Set(['f', 'p', 's'])

export const isHostOwnedGuestKey = (event: Pick<WebviewKeyPayload, 'key' | 'ctrlKey' | 'metaKey'>): boolean =>
  (event.ctrlKey || event.metaKey) && HOST_OWNED_KEYS.has(event.key.toLowerCase())

/**
 * Whether a guest keydown could resolve to a host command. Forwarding everything would
 * put every keystroke on the IPC channel — plaintext characters from guest login forms
 * included — and re-run keybinding resolution per character.
 *
 * Bindable *is* the criterion, so this defers to {@link isValidShortcut} rather than
 * approximating it: whatever a user can bind, a guest can reach the host with.
 */
export const isForwardableGuestKey = (event: KeyboardEventLike): boolean => {
  const binding = getShortcutBindingFromKeyboardEvent(event)
  // The find overlay drives next-match off a bare Enter. That is component handling
  // rather than a command, so no binding covers it.
  return isValidShortcut(binding) || (binding.length === 1 && binding[0] === 'Enter')
}

export const toWebviewKeyPayload = (event: KeyboardEvent): WebviewKeyPayload => ({
  key: event.key,
  code: event.code,
  ctrlKey: event.ctrlKey,
  metaKey: event.metaKey,
  shiftKey: event.shiftKey,
  altKey: event.altKey,
  repeat: event.repeat,
  isTrusted: event.isTrusted
})
