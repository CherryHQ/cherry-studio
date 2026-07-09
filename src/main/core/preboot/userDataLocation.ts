import fs from 'node:fs'
import path from 'node:path'

import { loggerService } from '@logger'
import { isLinux, isPortable, isWin } from '@main/core/platform'
import { bootConfigService } from '@main/data/bootConfig'
import { app } from 'electron'

const logger = loggerService.withContext('Preboot')
const DEFAULT_DEV_USER_DATA_SUFFIX = 'Dev'

export class InvalidConfiguredUserDataPathError extends Error {
  constructor(
    readonly exe: string,
    readonly configuredPath: string,
    readonly reason: string
  ) {
    super(`Configured userData path is not usable: ${configuredPath}: ${reason}`)
    this.name = 'InvalidConfiguredUserDataPathError'
  }
}

export type UserDataDirValidationResult = { ok: true } | { ok: false; reason: string }

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
 */

/**
 * Normalize app.getPath('exe') for use as a BootConfig `app.user_data_path`
 * key.
 *
 * Rationale: AppImage and Windows portable builds write a "stable"
 * executable path that survives relocation, so the lookup key is stable
 * across runs. Must match v1 init.ts:51-60 / 93-101 behavior so migrated
 * data resolves.
 *
 * Exported because the v2 userData relocation flow (IPC handler +
 * preboot gate, see `core/preboot/relocation/`) also needs this same
 * normalization to write/commit under the right key.
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
 * Record a userData relocation request in BootConfig and flush.
 *
 * Writes `temp.user_data_relocation = { status: 'pending', from, to, copy }`
 * so the next launch's preboot relocation gate (see
 * `core/preboot/relocation/relocationGate.ts`) picks it up, performs the
 * copy (when `copy` is true), commits the new location to
 * `app.user_data_path`, and relaunches.
 *
 * The caller (the IPC handler) is responsible for triggering the relaunch
 * after this returns. Nothing about the live userData path changes here —
 * the actual relocation happens exclusively in preboot on the next launch,
 * after the previous process has fully exited and no file is locked.
 */
export function requestRelocation(from: string, to: string, copy: boolean): void {
  const canonicalFrom = canonicalizeUserDataPath(from)
  const canonicalTo = canonicalizeUserDataPath(to)
  bootConfigService.set('temp.user_data_relocation', {
    status: 'pending',
    from: canonicalFrom,
    to: canonicalTo,
    copy
  })
  bootConfigService.flush()
  logger.info('userData relocation requested; relaunch required', {
    from: canonicalFrom,
    to: canonicalTo,
    copy
  })
}

/**
 * Commit a successful relocation to BootConfig so resolveUserDataLocation()
 * applies it on every subsequent launch.
 *
 * Writes `app.user_data_path[exe] = targetPath` and clears the pending
 * `temp.user_data_relocation` request. Called by the preboot relocation
 * gate after the copy (if any) succeeds.
 */
export function commitRelocation(targetPath: string): void {
  const canonicalTargetPath = canonicalizeUserDataPath(targetPath)
  const exe = getNormalizedExecutablePath()
  const current = bootConfigService.get('app.user_data_path') ?? {}
  bootConfigService.set('app.user_data_path', { ...current, [exe]: canonicalTargetPath })
  bootConfigService.set('temp.user_data_relocation', null)
  bootConfigService.flush()
  logger.info('userData relocation committed to BootConfig', { exe, targetPath: canonicalTargetPath })
}

export function clearCommittedUserDataLocation(exe = getNormalizedExecutablePath()): void {
  const current = bootConfigService.get('app.user_data_path') ?? {}
  const remaining = { ...current }
  delete remaining[exe]
  bootConfigService.set('app.user_data_path', remaining)
  bootConfigService.flush()
  logger.warn('Committed userData location cleared from BootConfig', { exe })
}

export function canonicalizeUserDataPath(userDataPath: string): string {
  if (!path.isAbsolute(userDataPath)) {
    throw new Error(`userData path must be absolute: ${userDataPath}`)
  }
  return path.normalize(userDataPath)
}

/**
 * Resolve where the Electron userData directory should live and call
 * app.setPath('userData', ...).
 *
 * Timing constraint: MUST run before `application.bootstrap()` is called.
 * The constraint is documented in Application.ts:119-126 — bootstrap()
 * invokes buildPathRegistry() at its entry, which freezes the path
 * registry by reading app.getPath('userData'). All app.setPath() calls
 * must have completed before that point.
 *
 * This function intentionally does NOT execute any pending relocation
 * (`temp.user_data_relocation`). It resolves userData to the **currently
 * committed** location (or Electron default / portable fallback) so that
 * the preboot relocation gate — which runs later, after app.whenReady() —
 * sees the OLD userData as `app.getPath('userData')` (= the relocation's
 * `from`) while it has a window up to report progress. The gate performs
 * the copy, commits the new path, and relaunches; on that next launch
 * this function reads the freshly-committed `app.user_data_path[exe]`
 * and points userData at the NEW location.
 *
 * Logic order:
 *
 *   1. Dev (unpackaged): append a 'Dev' suffix to isolate dev data from
 *      production. Relocation is a packaged-only concern, so BootConfig
 *      and the relocation gate are bypassed entirely in dev.
 *
 *   2. BootConfig as single source of truth: resolve from
 *      `app.user_data_path[exe]`. If valid, setPath. Otherwise fall through.
 *
 *   3. Portable fallback for Windows portable builds.
 *
 *   4. Fall through to Electron default.
 *
 * Normal-flow path: BootConfig is the single source of truth. The v1→v2
 * migration handles its own userData detection inside the migration
 * system — do NOT add fallbacks to v1 config.json here.
 */
export function resolveUserDataLocation(): void {
  if (!app.isPackaged) {
    // Dev mode: isolate dev data from production by appending 'Dev'.
    const devPath = app.getPath('userData') + resolveDevUserDataSuffix()
    app.setPath('userData', devPath)
    logger.info('userData set with dev suffix', { devPath })
    return
  }

  // BootConfig as single source of truth. A configured but unusable path is
  // fail-closed: silently falling back to Electron's default can make data
  // appear lost and may bootstrap services against the wrong directory.
  const exe = getNormalizedExecutablePath()
  const resolved = bootConfigService.get('app.user_data_path')?.[exe]
  if (resolved) {
    const validation = validateUserDataDir(resolved)
    if (!validation.ok) {
      const pendingRelocation = bootConfigService.get('temp.user_data_relocation')
      if (pendingRelocation?.status === 'pending' && pendingRelocation.copy === false) {
        logger.warn('Committed userData path is not usable; pending switch-only relocation will run', {
          exe,
          resolved,
          reason: validation.reason,
          to: pendingRelocation.to
        })
        return
      }
      throw new InvalidConfiguredUserDataPathError(exe, resolved, validation.reason)
    }
    app.setPath('userData', resolved)
    logger.info('userData set from BootConfig', { exe, resolved })
    return
  }

  // Portable fallback.
  if (isPortable) {
    const portableDir = process.env.PORTABLE_EXECUTABLE_DIR
    const portablePath = path.join(portableDir || app.getPath('exe'), 'data')
    app.setPath('userData', portablePath)
    logger.info('userData set for portable build', { portablePath })
    return
  }

  // Electron default.
}

function resolveDevUserDataSuffix(): string {
  return process.env.CS_DEV_USER_DATA_SUFFIX?.trim() || DEFAULT_DEV_USER_DATA_SUFFIX
}

/**
 * Synchronous validation: directory exists and is writable.
 * Intentionally inline — we cannot use the async hasWritePermission from
 * src/main/utils/file.ts during the synchronous preboot chain.
 */
export function validateUserDataDir(p: string): UserDataDirValidationResult {
  try {
    if (!path.isAbsolute(p)) return { ok: false, reason: 'path is not absolute' }
    if (!fs.existsSync(p)) return { ok: false, reason: 'path does not exist' }
    const lstat = fs.lstatSync(p)
    if (typeof lstat.isSymbolicLink === 'function' && lstat.isSymbolicLink()) {
      return { ok: false, reason: 'path is a symlink' }
    }
    const stat = fs.statSync(p)
    if (typeof stat.isDirectory === 'function' && !stat.isDirectory()) {
      return { ok: false, reason: 'path is not a directory' }
    }
    fs.accessSync(p, fs.constants.W_OK)
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: (error as Error).message }
  }
}
