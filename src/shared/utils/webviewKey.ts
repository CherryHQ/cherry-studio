/**
 * Keyboard relay between a MiniApp `<webview>` guest and its host window.
 *
 * A guest's keydown never reaches the host window's listener, so renderer-scope
 * shortcuts would silently die inside a MiniApp. The guest preload forwards
 * shortcut-shaped keydowns over {@link MINI_APP_KEYDOWN_CHANNEL} and the host
 * re-dispatches them, letting the normal keybinding resolution decide what runs.
 */

/** `sendToHost` channel the MiniApp guest preload uses to reach its host window. */
export const MINI_APP_KEYDOWN_CHANNEL = 'miniapp:keydown'

/** Keyboard data forwarded from a MiniApp guest, shaped for `new KeyboardEvent()`. */
export type MiniAppKeyPayload = {
  key: string
  code: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
  repeat: boolean
  isTrusted: boolean
}

// The host owns find/print/save inside MiniApps, so the guest page must not also
// run the browser default for them.
const HOST_OWNED_KEYS = new Set(['f', 'p', 's'])

export const isHostOwnedGuestKey = (event: Pick<MiniAppKeyPayload, 'key' | 'ctrlKey' | 'metaKey'>): boolean =>
  (event.ctrlKey || event.metaKey) && HOST_OWNED_KEYS.has(event.key.toLowerCase())

// Keys that can carry a shortcut on their own. Everything else only qualifies with a
// modifier, which keeps ordinary typing — passwords included — inside the guest frame.
const BARE_SHORTCUT_KEYS = new Set(['Escape', 'Enter', 'Tab'])

const isFunctionKey = (key: string) => /^F([1-9]|1[0-2])$/.test(key)

/**
 * Whether a guest keydown could resolve to a host command. Forwarding everything would
 * put every keystroke on the IPC channel and re-run keybinding resolution per character.
 *
 * A user-rebound bare letter key would not reach the host; no shipped binding uses one
 * (`Escape` is the only bare default, and it is non-editable).
 */
export const isForwardableGuestKey = (event: Pick<MiniAppKeyPayload, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>) =>
  event.ctrlKey || event.metaKey || event.altKey || BARE_SHORTCUT_KEYS.has(event.key) || isFunctionKey(event.key)

export const toMiniAppKeyPayload = (event: KeyboardEvent): MiniAppKeyPayload => ({
  key: event.key,
  code: event.code,
  ctrlKey: event.ctrlKey,
  metaKey: event.metaKey,
  shiftKey: event.shiftKey,
  altKey: event.altKey,
  repeat: event.repeat,
  isTrusted: event.isTrusted
})
