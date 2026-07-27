/**
 * User-driven shell-pane toggle marker. Programmatic opens such as history
 * locate, layout resets, and auto-restore do not increment it.
 */
export interface PaneManualToggleSignal {
  seq: number
  open: boolean
}
