/**
 * FileManagerDeps — the dependency bundle every `internal/*` pure-function
 * module receives as its first argument.
 *
 * Construction wires the service singletons (`fileEntryService`,
 * `fileRefService`, `danglingCache`, `orphanCheckerRegistry`) plus a fresh
 * per-FileManager `VersionCache`; the bundle is built once inside
 * `FileManager`'s class body and forwarded to every internal call.
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
