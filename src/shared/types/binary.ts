import type { BinaryManifestEntry } from '@shared/data/preference/preferenceTypes'

/**
 * Live install activity for a tool, owned by the main process so every window
 * (and a window opened mid-install) renders the same installing/failed state.
 * Success clears the entry — "installed" is derived from BinaryResolution.
 * A failed entry persists until a retry starts or the tool is removed.
 */
export type BinaryInstallState = { status: 'installing' } | { status: 'failed'; error: string }

export type BinaryInstallStates = Record<string, BinaryInstallState>

/** A BinaryManager inventory entry: persisted installs are manageable; auto-discovered runtimes are display-only. */
export type BinaryToolInventoryEntry =
  | { name: string; tool: string; version: string; managed: true }
  | { name: string; tool: string; version: string; managed: false }

export type BinaryResolution =
  | { source: 'managed'; path: string; version: string }
  | { source: 'bundled'; path: string; version?: string }
  | { source: 'system'; path: string }
  | { source: 'none' }

export type BinaryResolutions = Record<string, BinaryResolution>

/** An install command separates durable user intent from a one-shot version target. */
export type BinaryInstallRequest = {
  intent: BinaryManifestEntry
  targetVersion?: string
}

/** Runtime availability independently observed by BinaryManager. */
export type BinaryAvailability =
  | { source: 'mise'; tool: string; path: string; version?: string }
  | { source: 'bundled'; path: string; version?: string }
  | { source: 'system'; path: string }
  | { source: 'none' }

/** Transient operation status, held outside the durable manifest. */
export type BinaryOperation =
  | { status: 'installing' }
  | { status: 'removing' }
  | { status: 'failed'; action: 'install' | 'remove'; error: string; intent?: BinaryManifestEntry }

/** Main-computed runtime facts for one binary. */
export type BinaryToolSnapshot = {
  name: string
  intent?: BinaryManifestEntry
  availability: BinaryAvailability
  operation?: BinaryOperation
}
