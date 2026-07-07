import type React from 'react'

/**
 * Props the PopupHost injects into every createPopup component. A popup component
 * receives these in addition to its own props; it must not declare or supply them.
 */
export interface PopupInjectedProps<R> {
  /** Drives `<Dialog open>`; flips to false when the popup enters its exit phase. */
  open: boolean
  /**
   * Settle the popup promise and start the exit phase. Idempotent — the second and
   * later calls are no-ops (the store drops the entry once it is closing).
   */
  resolve: (result: R) => void
}

export type PopupComponent<P, R> = React.ComponentType<P & PopupInjectedProps<R>>

export interface PopupHandle<P, R> {
  /**
   * Show the popup and resolve with its result. Single-flight: while a previous
   * show() is still in flight this returns the SAME promise and ignores `props`.
   * `props` is optional only when `P` has no required fields (a propless popup).
   */
  show(...args: {} extends P ? [props?: P] : [props: P]): Promise<R>
  /** Settle the in-flight popup with `dismissResult`; a no-op when not showing. */
  hide(): void
}

export interface CreatePopupOptions<R> {
  /**
   * Result used when the popup is dismissed without an explicit answer — host-side
   * `hide()` and the no-host fallback. Provide it for any non-void `R` so the type
   * stays honest (e.g. `createPopup<Params, string | null>(C, { dismissResult: null })`).
   */
  dismissResult?: R
}

export type ConfirmPopupType = 'confirm' | 'error' | 'info' | 'warning'

type ConfirmButtonProps = {
  danger?: boolean
  disabled?: boolean
  style?: React.CSSProperties
  className?: string
}

/**
 * The prefab-dialog config for confirm/error/info/warning. These prefabs are
 * promise-only: the outcome is delivered by the returned `Promise<boolean>` (true =
 * confirmed/acknowledged, false = cancelled/dismissed), so you react to it with
 * `await`, not callbacks — there is no `onOk`/`onCancel`. A dialog that needs to own
 * interactive state (an in-flight spinner, a multi-step flow, a non-boolean answer)
 * is not a prefab: build it with `createPopup<P, R>` instead.
 *
 * Also dropped from the antd-era modal surface: no generic `afterClose` hook (the one
 * real post-close need — returning focus — is served by the narrower `focusOnClose`
 * below), no `destroyAll`/`update`/`destroy` handle, no `warn`/`success`.
 */
export interface ConfirmPopupProps {
  title?: React.ReactNode
  content?: React.ReactNode
  okText?: React.ReactNode
  cancelText?: React.ReactNode
  okButtonProps?: ConfirmButtonProps
  cancelButtonProps?: Omit<ConfirmButtonProps, 'danger'>
  centered?: boolean
  width?: string | number
  icon?: React.ReactNode
  maskClosable?: boolean
  closable?: boolean
  className?: string
  rootClassName?: string
  style?: React.CSSProperties
  okCancel?: boolean
  /**
   * Place focus when the dialog closes, overriding Radix's default focus-return.
   *
   * Radix's default: on close its `FocusScope` returns focus to whatever element was
   * focused right before the dialog opened. That is correct for a button-triggered
   * dialog, but wrong for an imperatively-opened popup whose opener is gone by close
   * time (e.g. a popover / command-menu item that has since unmounted) — Radix then
   * lands focus on a stale element or the document body.
   *
   * Provide `focusOnClose` to take over: the host suppresses that default (Radix
   * `onCloseAutoFocus` + `preventDefault`) and calls this instead, so focus lands
   * exactly where you put it with no race and no `requestAnimationFrame` — e.g.
   * `() => triggerButton.focus()`. Omit to keep Radix's default.
   */
  focusOnClose?: () => void
}

interface PopupEntryBase {
  instanceId: string
  /** True while shown; flips to false during the exit phase before removal. */
  open: boolean
  /** The promise resolver; settling the entry calls it exactly once. */
  resolve: (result: unknown) => void
}

export interface ComponentPopupEntry extends PopupEntryBase {
  kind: 'component'
  Component: PopupComponent<any, any>
  props: Record<string, unknown>
}

export interface ConfirmPopupEntry extends PopupEntryBase {
  kind: 'confirm'
  confirmType: ConfirmPopupType
  props: ConfirmPopupProps
}

export type PopupEntry = ComponentPopupEntry | ConfirmPopupEntry
