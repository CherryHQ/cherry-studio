import { popupService } from './PopupService'
import type { ConfirmPopupProps } from './types'

/**
 * Prefab dialogs — the standard confirm/acknowledge boxes you get without writing a
 * component. All resolve `Promise<boolean>` (true = confirmed/acknowledged, false =
 * cancelled/dismissed). `confirm` shows OK + Cancel; `error`/`info`/`warning` are
 * strong one-way acknowledgements (OK only) but still belong to the dialog track
 * because they must be clicked away. The rendering lives in PopupHost's
 * ConfirmPopupItem, keeping this an ordinary data-in / promise-out call.
 */
const confirm = (props: ConfirmPopupProps): Promise<boolean> => popupService.showConfirm('confirm', props)

const error = (props: ConfirmPopupProps): Promise<boolean> => popupService.showConfirm('error', props)

const info = (props: ConfirmPopupProps): Promise<boolean> => popupService.showConfirm('info', props)

const warning = (props: ConfirmPopupProps): Promise<boolean> => popupService.showConfirm('warning', props)

/**
 * The dialog-track facade — mirrors services/toast's `toast` object so the two
 * imperative tracks read symmetrically at the call site (`popup.confirm(...)` next to
 * `toast.success(...)`). Prefer this over importing the prefabs bare: `confirm`,
 * `error`, `info` and `warning` collide with `window.confirm`, `catch (error)`, etc.
 */
export const popup = { confirm, error, info, warning }
