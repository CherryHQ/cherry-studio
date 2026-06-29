/**
 * Initialization payload for the main window.
 *
 * Delivered through WindowManager initData so fresh windows pull it after mount
 * and existing windows receive it through the `window.reused` update path.
 */
export type MainWindowInitData = {
  openSettingsTab: true
}
