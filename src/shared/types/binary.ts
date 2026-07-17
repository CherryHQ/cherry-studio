import type { CustomToolDefinition } from '@shared/data/preference/preferenceTypes'

/** Transient main-owned operation state, shared across renderer windows. */
export type BinaryOperation =
  | { status: 'installing' }
  | { status: 'removing' }
  | { status: 'failed'; action: 'install' | 'remove'; error: string }

export type BinaryOperations = Record<string, BinaryOperation>

/**
 * Name-only install command. Main resolves the recipe from its code-owned fixed
 * catalog or the custom registry — the renderer never supplies a recipe on this
 * route (arbitrary recipes go through the Custom Add route instead).
 */
export type BinaryInstallByNameRequest = {
  name: string
  targetVersion?: string
}

/**
 * Remove command addressed by name. `definitionOnly` drops just a custom tool's
 * durable definition without touching the backend — valid only for a custom
 * tool (a fixed tool has no removable definition, so the route rejects it).
 */
export type BinaryRemoveRequest = {
  name: string
  definitionOnly?: boolean
}

/**
 * Typed outcome of a remove. `removed` is the success terminal for every branch
 * (fixed cleanup, custom cleanup + definition delete, definition-only delete, or
 * an already-absent no-op). `cleanup_blocked` is a fail-closed non-error the
 * renderer branches on: the backend could not be safely cleaned, so nothing was
 * removed and — for a custom tool — its definition is retained. The renderer
 * never parses the message; it branches on `reason` and may surface `message` /
 * `dependents` for display.
 */
export type BinaryRemoveResult =
  | { status: 'removed' }
  | {
      status: 'cleanup_blocked'
      reason: 'backend_unavailable' | 'query_failed' | 'conflict' | 'dependency_blocked' | 'cleanup_failed'
      message?: string
      dependents?: string[]
    }

/** Runtime availability independently observed by BinaryManager. */
export type BinaryAvailability =
  | { source: 'mise'; path: string; version?: string }
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
  /** The user-added custom definition backing this name; absent for a fixed tool. */
  definition?: CustomToolDefinition
  /** Exact-backend-application fact, independent of `availability`. */
  application?: BinaryApplication
  availability: BinaryAvailability
  operation?: BinaryOperation
}
