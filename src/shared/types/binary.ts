/**
 * Live install activity for a tool, owned by the main process so every window
 * (and a window opened mid-install) renders the same installing/failed state.
 * Success clears the entry — "installed" is derived from BinaryResolution.
 * A failed entry persists until a retry starts or the tool is removed.
 */
export type BinaryInstallState = { status: 'installing' } | { status: 'failed'; error: string }

export type BinaryInstallStates = Record<string, BinaryInstallState>

export type BinaryResolution =
  | { source: 'managed'; path: string; version: string }
  | { source: 'bundled'; path: string; version?: string }
  | { source: 'system'; path: string }
  | { source: 'none' }

export type BinaryResolutions = Record<string, BinaryResolution>
