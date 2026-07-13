/**
 * Live install activity for a tool, owned by the main process so every window
 * (and a window opened mid-install) renders the same installing/failed state.
 * Success clears the entry — "installed" is derived from BinaryResolution.
 * A failed entry persists until a retry starts or the tool is removed.
 */
export type BinaryInstallState = { status: 'installing' } | { status: 'failed'; error: string }

export type BinaryInstallStates = Record<string, BinaryInstallState>

/** A BinaryManager inventory entry: persisted installs are manageable; runtime dependencies are display-only. */
export type BinaryToolInventoryEntry =
  | { name: string; tool: string; version: string; managed: true }
  | { name: string; tool: string; version: string; managed: false }

export type BinaryResolution =
  | { source: 'managed'; path: string; version: string }
  | { source: 'bundled'; path: string; version?: string }
  | { source: 'system'; path: string }
  | { source: 'none' }

export type BinaryResolutions = Record<string, BinaryResolution>
