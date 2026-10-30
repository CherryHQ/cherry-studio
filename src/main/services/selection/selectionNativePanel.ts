import type { Rectangle } from 'electron'

import { application } from '@application'

/** [macOS] The selection panel addon built from `native/darwin/selectionPanel.mm`; see `native/README.md`. */
export interface SelectionNativePanel {
  configurePanel(handle: Buffer): void
  moveToActiveSpace(handle: Buffer): void
  /** Receives the native handle of a marked panel whose yellow light or Cmd+M was used. */
  setMiniaturizeHandler(handler: (handle: Buffer) => void): void
  interceptMiniaturize(handle: Buffer): void
  /** Whether the frontmost app's focused window is in full screen; false without Accessibility access. */
  isFrontmostFullScreen(): boolean
  /** Animates to the bounds and opacity without blocking the main thread; resolves when it ends. */
  animateWindow(handle: Buffer, bounds: Rectangle, opacity: number, durationMs: number): Promise<void>
}

let nativePanel: SelectionNativePanel | undefined

export function getSelectionNativePanel(): SelectionNativePanel {
  return (nativePanel ??= require(application.getPath('feature.selection.native_panel_file')))
}
