/**
 * services/popup — the imperative entry to the app's dialog track (blocking,
 * answer-returning interactions). Its counterpart is services/toast (the
 * non-blocking notification track).
 *
 * Which API do I want?
 *  - Await an answer / value from the user      → createPopup(Component) → handle.show(props): Promise<R>
 *  - A standard confirm or strong acknowledge   → popup.confirm / popup.error / popup.info / popup.warning
 *  - The open state belongs to a parent         → inline controlled `<Dialog open>` — do NOT route through here
 *  - An anchored overlay (menu/popover/tooltip) → the Radix primitive directly — not a popup
 *
 * Contract:
 *  - single-flight: while handle.show() is in flight, a second show(propsB) returns the FIRST promise; propsB is ignored.
 *  - no host: with no <PopupHost/> mounted, show() logs a dev warning and immediately resolves(dismissResult) — it
 *    never hangs and never rejects. Popups are therefore unusable on a window-startup path (the host subscribes only
 *    after its first commit).
 *  - React.lazy: a popup component that lazy-loads must carry its own <Suspense> boundary — useSyncExternalStore
 *    updates are not transitions and will surface the nearest fallback (see components/Popups/SearchPopup for the shape).
 */
export { createPopup } from './createPopup'
export { POPUP_EXIT_MS, popupService } from './PopupService'
export { popup } from './presets'
export type {
  ComponentPopupEntry,
  ConfirmPopupEntry,
  ConfirmPopupProps,
  ConfirmPopupType,
  CreatePopupOptions,
  PopupComponent,
  PopupEntry,
  PopupHandle,
  PopupInjectedProps
} from './types'
