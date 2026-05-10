/**
 * FileManagerDeps — the dependency bundle every `internal/*` pure-function
 * module receives as its first argument.
 *
 * Phase status: Phase 1a exports the type only. The actual construction
 * (wiring service singletons, versionCache instance, danglingCache singleton)
 * happens inside the future `FileManager.onInit` (Phase 1b.x).
 *
 * ## Design
 *
 * Each `internal/entry/*` / `internal/content/*` / `internal/system/*` module
 * is a pure function that takes `(deps, params) => result`. FileManager holds
 * the deps bundle as a private field and forwards it on every delegation.
 *
 * This pattern lets us:
 * - Unit-test `internal/*` functions directly with stub deps — no need to
 *   mock FileManager or spin up the lifecycle.
 * - Make the explicit dependency set visible at every call site, so adding
 *   a new dep (e.g. a future `FileUploadService`) is a type-level event
 *   callers notice.
 */

import type { FileEntryService } from '@data/services/FileEntryService'
import type { FileRefService } from '@data/services/FileRefService'
import type { OrphanCheckerRegistry } from '@data/services/orphan/FileRefCheckerRegistry'

import type { DanglingCache } from '../danglingCache'
import type { VersionCache } from '../versionCache'

export interface FileManagerDeps {
  readonly fileEntryService: FileEntryService
  readonly fileRefService: FileRefService
  readonly danglingCache: DanglingCache
  readonly versionCache: VersionCache
  readonly orphanRegistry: OrphanCheckerRegistry
}
