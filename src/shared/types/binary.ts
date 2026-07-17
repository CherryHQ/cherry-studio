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
  | {
      source: 'mise'
      /**
       * @deprecated Phase 1 compatibility field only. It reports the mise recipe
       * behind a runnable shim, but it must NOT be used to decide whether the
       * exact managed recipe is applied — read {@link BinaryApplication} for that.
       * Phase 2/3 consumers still compile against it; do not remove yet.
       */
      tool: string
      path: string
      version?: string
    }
  | { source: 'bundled'; path: string; version?: string }
  | { source: 'system'; path: string }
  | { source: 'none' }

/**
 * Whether the exact managed recipe for a tool is applied through the mise
 * backend — an independent live fact, deliberately distinct from runnable
 * {@link BinaryAvailability}. A tool can be runnable yet not exactly applied
 * (a foreign shim mise still resolves → `conflict`), and a backend that cannot
 * answer yields `unknown` rather than a misleading `absent`.
 *
 * - `applied`  — the exact recipe has installed entries and a runnable isolated shim.
 * - `broken`   — the exact recipe has installed entries but no executable shim.
 * - `absent`   — the exact recipe has no installed entries (and no live shim of its own).
 * - `conflict` — no exact entries, but a shim mise still resolves to a runnable target.
 * - `unknown`  — the mise backend was unavailable or its query failed/was malformed.
 */
export type BinaryApplication =
  | { status: 'applied'; version?: string }
  | { status: 'broken'; version?: string }
  | { status: 'absent' }
  | { status: 'conflict' }
  | { status: 'unknown'; reason: 'backend_unavailable' | 'query_failed' }

/** Main-computed runtime facts for one binary. */
export type BinaryToolSnapshot = {
  name: string
  intent?: BinaryManifestEntry
  availability: BinaryAvailability
  /** Exact-backend-application fact, independent of `availability` (Phase 1: optional). */
  application?: BinaryApplication
  operation?: BinaryOperation
}
