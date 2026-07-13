import type { BinaryManifestEntry } from '@shared/data/preference/preferenceTypes'

/** Transient main-owned operation state, shared across renderer windows. */
export type BinaryOperation =
  | { status: 'installing' }
  | { status: 'removing' }
  | { status: 'failed'; action: 'install' | 'remove'; error: string; intent?: BinaryManifestEntry }

export type BinaryOperations = Record<string, BinaryOperation>

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
