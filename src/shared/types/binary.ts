import type { BinaryManifestEntry } from '@shared/data/preference/preferenceTypes'

/** Transient main-owned operation state, shared across renderer windows. */
export type BinaryOperation =
  | { status: 'installing' }
  | { status: 'removing' }
  | { status: 'failed'; action: 'install' | 'remove'; error: string; intent?: BinaryManifestEntry }

export type BinaryOperations = Record<string, BinaryOperation>

/** A BinaryManager inventory entry: persisted installs are manageable; auto-discovered runtimes are display-only. */
export type BinaryToolInventoryEntry =
  | { name: string; tool: string; version: string; requestedVersion?: string; managed: true }
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

/** Main-computed runtime facts for one binary. */
export type BinaryToolSnapshot = {
  name: string
  intent?: BinaryManifestEntry
  availability: BinaryAvailability
  operation?: BinaryOperation
}
