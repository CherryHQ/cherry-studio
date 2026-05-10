import fs from 'node:fs'
import path from 'node:path'

import { loggerService } from '@logger'
import { isLinux, isPortable, isWin } from '@main/constant'
import { bootConfigService } from '@main/data/bootConfig'
import type { BootConfigSchema } from '@shared/data/bootConfig/bootConfigSchemas'
import { app } from 'electron'

const logger = loggerService.withContext('Preboot')

/**
 * Terminology — read this before editing
 * --------------------------------------
 *
 * "userData" in this file always refers to Electron's
 * `app.getPath('userData')` directory tree — the OS-level directory where
 * Chromium and Electron persist their state alongside whatever the
 * application chooses to put there.
 *
 * It does NOT mean "user data" in the colloquial Chinese sense (用户数据).
 * The Electron userData directory contains BOTH:
 *
 *   - User content    (cherrystudio.sqlite, Data/Files, Data/KnowledgeBase,
 *                      Data/Notes, Cookies, etc.)
 *   - Chromium runtime state  (Network/, Partitions/webview/Network/,
 *                              IndexedDB, Local Storage, Service Worker, ...)
 *   - Application logs   (logs/, written by winston)
 *
 * When this file says "copy the userData directory" or "the userData has
 * been relocated", it means **the entire OS directory** is being moved as
 * a single opaque tree — not a curated subset of "user content".
 *
 * v1 used to distinguish "occupied dirs" (logs/Network/Partitions, locked
 * by the running process on Windows) from the rest, and copy them in two
 * separate phases. v2 abandons that distinction: the entire directory is
 * copied at startup, when the previous process has fully exited and no
 * file is locked. See `packages/shared/config/constant.ts:occupiedDirs`
 * for the deprecated v1 constant.
 */

/**
 * Reuse the relocation state type from the generated BootConfig schema via
 * indexed access. Keeps this alias automatically in sync with any schema
 * change — there is no hand-written duplicate to drift out of date.
 */
type UserDataRelocationState = NonNullable<BootConfigSchema['temp.user_data_relocation']>
type PendingRelocation = Extract<UserDataRelocationState, { status: 'pending' }>

/**
 * Normalize app.getPath('exe') for use as a BootConfig `app.user_data_path`
 * key.
 *
 * Rationale: AppImage and Windows portable builds write a "stable"
 * executable path that survives relocation, so the lookup key is stable
 * across runs. Must match v1 init.ts:51-60 / 93-101 behavior so migrated
 * data resolves.
 *
 * Exported because the v2 IPC handler (App_SetAppDataPath, to be migrated
 * in a follow-up PR) also needs this same normalization to write into
 * BootConfig under the right key.
 */
export function getNormalizedExecutablePath(): string {
  if (isLinux && process.env.APPIMAGE) {
    return path.join(path.dirname(process.env.APPIMAGE), 'cherry-studio.appimage')
  }
  if (isWin && isPortable) {
    return path.join(process.env.PORTABLE_EXECUTABLE_DIR || '', 'cherry-studio-portable.exe')
  }
  return app.getPath('exe')
}

/**
 * Resolve where the Electron userData directory should live, applying any
 * pending relocation along the way, and call app.setPath('userData', ...).
 *
 * Timing constraint: MUST run before `application.bootstrap()` is called.
 * The constraint is documented in Application.ts:119-126 — bootstrap()
 * invokes buildPathRegistry() at its entry, which freezes the path
 * registry by reading app.getPath('userData'). All app.setPath() calls
 * must have completed before that point.
 *
 * Logic order:
 *
 *   1. If BootConfig has a `pending` relocation request, execute it now
 *      (synchronously copy from → to). On success, commit the new location
 *      to `app.user_data_path` and clear the request. On failure, mark
 *      the request as `failed` — the user keeps running on the previous
 *      location until they decide what to do via a future renderer
 *      recovery flow.
 *
 *   2. Resolve the userData location from `app.user_data_path[exe]`.
 *      If valid, setPath. Otherwise fall through.
 *
 *   3. Portable fallback for Windows portable builds.
 *
 *   4. Fall through to Electron default.
 *
 * Normal-flow path: BootConfig is the single source of truth. The v1→v2
 * migration handles its own userData detection inside the migration
 * system — do NOT add fallbacks to v1 config.json here.
 *
 * Dev (unpackaged) runs take a separate, much simpler branch: append a
 * 'Dev' suffix to Electron's default userData so the dev process can't
 * pollute production data. BootConfig and pending relocations do not
 * apply in dev — they're packaged-only concerns.
 */
export function resolveUserDataLocation(): void {
  if (!app.isPackaged) {
    // Escape hatch: skip the Dev suffix so the dev process reads/writes
    // the same userData a packaged build would use. Useful for testing
    // migration against real production data without rebuilding. Set via
    // the `dev:prod-data` npm script — see package.json.
    if (process.env.CHERRY_DEV_USE_PROD_USERDATA === '1') {
      logger.warn('Dev mode using production userData (CHERRY_DEV_USE_PROD_USERDATA=1)', {
        userData: app.getPath('userData')
      })
      return
    }

    // Dev mode: isolate dev data from production by appending 'Dev'.
    // Capture into a local before setPath so we log the value we wrote
    // (matches the local-variable pattern used by the portable branch).
    const devPath = app.getPath('userData') + 'Dev'
    app.setPath('userData', devPath)
    logger.info('userData set with dev suffix', { devPath })
    return
  }

  // Step 1: process pending relocation, if any.
  //
  // `failed` records are intentionally NOT retried automatically — they
  // sit in BootConfig until the user (via a future renderer recovery
  // flow) decides to retry, abandon, or investigate. Automatic retry on
  // every startup would risk turning a one-off environmental failure
  // (e.g. target disk temporarily unmounted) into an infinite loop.
  const relocation = bootConfigService.get('temp.user_data_relocation')
  if (relocation?.status === 'pending') {
    executePendingRelocation(relocation)
    // After this returns, BootConfig is in one of two states:
    //   - success: app.user_data_path has been updated, temp cleared to null
    //   - failure: temp is now { status: 'failed', ... }, app.user_data_path unchanged
    // Either way, fall through to Step 2 to read the (possibly updated)
    // app.user_data_path and setPath accordingly.
  }

  // Step 2: BootConfig as single source of truth.
  const exe = getNormalizedExecutablePath()
  const resolved = bootConfigService.get('app.user_data_path')?.[exe]
  if (resolved && isValidDataDir(resolved)) {
    app.setPath('userData', resolved)
    logger.info('userData set from BootConfig', { exe, resolved })
    return
  }

  // Step 3: portable fallback.
  if (isPortable) {
    const portableDir = process.env.PORTABLE_EXECUTABLE_DIR
    const portablePath = path.join(portableDir || app.getPath('exe'), 'data')
    app.setPath('userData', portablePath)
    logger.info('userData set for portable build', { portablePath })
    return
  }

  // Step 4: Electron default.
}

/**
 * Execute a pending userData relocation by copying the entire `from` tree
 * to `to`, then committing the new location to BootConfig.
 *
 * Synchronous — preboot is a single-threaded sync phase, so the main
 * process is blocked during the copy. There is no progress UI in this
 * implementation; a future PR will introduce a dedicated relocation
 * window (owned by the renderer) for progress reporting and for handling
 * the `failed` recovery flow.
 *
 * Failure handling: if anything throws (pre-flight check or cpSync), the
 * error is recorded in BootConfig as a `failed` transient state and the
 * function returns normally. resolveUserDataLocation() will then fall
 * through to the existing `app.user_data_path` value (the OLD path), so
 * the user can keep using the app while the failure awaits user action.
 *
 * Known limitation — logger does not follow the relocation:
 *   LoggerService opens its winston file transport at module-load time,
 *   pointing at `app.getPath('logs')` — which on Windows/Linux resolves
 *   to `<userData>/logs`. This happens *before* preboot runs, so the
 *   winston file handle is bound to the OLD userData's logs directory.
 *   After we call setPath('userData', <new>) in Step 2 of
 *   resolveUserDataLocation, `app.getPath('logs')` starts returning the
 *   new path, but winston continues writing to the handle it already
 *   opened at the old path. Post-relocation logs therefore appear at the
 *   OLD location, not the new one, until the next restart.
 *
 *   This is a pre-existing v2 issue (LoggerService doesn't respond to
 *   setPath) and is out of scope for this PR. A follow-up should either
 *   lazy-open winston transports or teach LoggerService to rotate on
 *   userData change. The cpSync *does* copy the snapshot of logs at the
 *   moment of copy, so the new location starts with a historical log
 *   archive — it just won't receive new entries until the next start.
 */
function executePendingRelocation(pending: PendingRelocation): void {
  const { from, to } = pending
  logger.info('Executing pending userData relocation', { from, to })
  try {
    // Pre-flight checks — fail fast before any bytes are copied so we
    // don't leave partial data under `to` on trivially-preventable
    // errors. The renderer/IPC layer is the first line of defense for
    // these checks (see BasicDataSettings.tsx's isPathInside guard and
    // write-permission probe), but BootConfig can also be edited by
    // hand, so preboot re-checks as a safety net.
    const fromAbs = path.resolve(from)
    const toAbs = path.resolve(to)
    if (fromAbs === toAbs) {
      throw new Error(`source and target are the same path: ${fromAbs}`)
    }
    // Target inside source would make cpSync recurse into its own
    // output. path.sep guards against a false positive when `from` is a
    // prefix of an unrelated sibling directory (e.g. /a vs /ab).
    if (toAbs.startsWith(fromAbs + path.sep)) {
      throw new Error(`target is inside source (would recurse): ${toAbs}`)
    }
    if (!fs.existsSync(from)) {
      throw new Error(`source does not exist: ${from}`)
    }
    const toParent = path.dirname(to)
    if (!fs.existsSync(toParent)) {
      throw new Error(`target parent directory does not exist: ${toParent}`)
    }
    fs.accessSync(toParent, fs.constants.W_OK)

    // cpSync options:
    //   - recursive: copy the whole tree
    //   - force: overwrite if the target already contains files (the
    //     renderer/IPC layer is responsible for ensuring `to` is safe
    //     to overwrite; see BasicDataSettings.tsx)
    //   - verbatimSymlinks: keep symlinks as symlinks instead of
    //     expanding them into copies of their targets, which would bloat
    //     the copy and silently pull in external data
    //
    // Note: `errorOnExist` is intentionally omitted — Node.js ignores it
    // when `force: true`, so setting it would be misleading.
    fs.cpSync(from, to, { recursive: true, force: true, verbatimSymlinks: true })

    // Commit: update user_data_path AND clear the transient request,
    // then flush so a crash before bootstrap completes can't lose the
    // commit. BootConfigService.flush() writes via temp file + rename so
    // the two set() calls land atomically on disk.
    const exe = getNormalizedExecutablePath()
    const current = bootConfigService.get('app.user_data_path') ?? {}
    bootConfigService.set('app.user_data_path', { ...current, [exe]: to })
    bootConfigService.set('temp.user_data_relocation', null)
    bootConfigService.flush()

    logger.info('userData relocation completed', { from, to })
  } catch (error) {
    const message = (error as Error).message
    bootConfigService.set('temp.user_data_relocation', {
      status: 'failed',
      from,
      to,
      error: message,
      failedAt: new Date().toISOString()
    })
    bootConfigService.flush()
    logger.error('userData relocation failed; continuing at previous location', {
      from,
      to,
      error: message
    })
    // Intentionally do NOT throw — let resolveUserDataLocation continue
    // to Step 2 and fall back to the existing app.user_data_path. The
    // failure record is now visible to future renderer code that wants
    // to show a recovery dialog (out of scope for this PR).
  }
}

/**
 * Synchronous validation: directory exists and is writable.
 * Intentionally inline — we cannot use the async hasWritePermission from
 * src/main/utils/file.ts during the synchronous preboot chain.
 */
function isValidDataDir(p: string): boolean {
  try {
    if (!fs.existsSync(p)) return false
    fs.accessSync(p, fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}
