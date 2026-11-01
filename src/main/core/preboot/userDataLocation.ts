import fs from 'node:fs'
import path from 'node:path'

import { app } from 'electron'

import { loggerService } from '@logger'
import { DEV_PROFILE_ROOT, resolveDevUserDataPath } from '@main/core/paths/constants'
import { isLinux, isPortable, isWin } from '@main/core/platform'
import { bootConfigService } from '@main/data/bootConfig'

const logger = loggerService.withContext('Preboot')

export type UserDataMappingFallbackReason = 'mapped-directory-unusable' | 'no-mapping-for-executable'

export interface UserDataMappingFallback {
  /** Normalized executable path of this build (getNormalizedExecutablePath()). */
  exe: string
  /** Directory Electron will actually use for this launch. */
  effectivePath: string
  /** The mapping entry that existed for this exe but could not be used. */
  mappedPath?: string
  reason: UserDataMappingFallbackReason
}

let userDataMappingFallback: UserDataMappingFallback | null = null

/** Diagnostic recorded by the last resolveUserDataLocation() call in this process. */
export function getUserDataMappingFallback(): UserDataMappingFallback | null {
  return userDataMappingFallback
}

function recordUserDataMappingFallback(fallback: UserDataMappingFallback): void {
  userDataMappingFallback = fallback
  const { exe, effectivePath, mappedPath, reason } = fallback
  logger.warn('userData mapping from BootConfig was not applied', { exe, effectivePath, mappedPath, reason })
}

/**
 * "userData" in this module means Electron's complete OS-level userData
 * directory, including user content, Chromium state, and — on Windows and
 * Linux — application logs. macOS normally keeps logs in ~/Library/Logs;
 * dev profile-root mode keeps them under the configured root on every OS.
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

export function canonicalizeUserDataPath(userDataPath: string): string {
  if (!path.isAbsolute(userDataPath)) {
    throw new Error(`userData path must be absolute: ${userDataPath}`)
  }
  return path.normalize(userDataPath)
}

/**
 * Resolve Electron's userData directory before the path registry is frozen.
 * Pending relocation is deliberately not executed here: after the source path
 * is resolved and its single-instance lock is acquired, the
 * `services/userDataRelocation` domain owns validation, copy/switch, commit,
 * progress UI, and relaunch (`runUserDataRelocation()` called from main.ts).
 * The `app.user_data_path` mapping read below is written by that domain's
 * commit step.
 *
 * Electron derives sessionData lazily from userData when no explicit
 * sessionData path was set. Keeping this setPath call before app.whenReady()
 * therefore carries Cookies, Local Storage, IndexedDB, and other Chromium
 * storage to the selected directory as well.
 */
export function resolveUserDataLocation(): void {
  userDataMappingFallback = null
  if (!app.isPackaged) {
    const devPath = resolveDevUserDataPath()
    if (DEV_PROFILE_ROOT) fs.mkdirSync(devPath, { recursive: true })
    app.setPath('userData', devPath)
    logger.info(DEV_PROFILE_ROOT ? 'userData set from dev profile root' : 'userData set with dev suffix', { devPath })
    return
  }

  const exe = getNormalizedExecutablePath()
  const mapping = bootConfigService.get('app.user_data_path')
  const resolved = mapping?.[exe]
  if (resolved && isUsableDataDir(resolved)) {
    app.setPath('userData', resolved)
    logger.info('userData set from BootConfig', { exe, resolved })
    return
  }

  if (isPortable) {
    const portableDir = process.env.PORTABLE_EXECUTABLE_DIR
    const portablePath = path.join(portableDir || app.getPath('exe'), 'data')
    app.setPath('userData', portablePath)
    logger.info('userData set for portable build', { portablePath })
    if (resolved !== undefined) {
      recordUserDataMappingFallback({
        exe,
        effectivePath: portablePath,
        mappedPath: resolved,
        reason: 'mapped-directory-unusable'
      })
    }
  } else if (resolved !== undefined || (mapping && Object.keys(mapping).length > 0)) {
    recordUserDataMappingFallback({
      exe,
      effectivePath: app.getPath('userData'),
      ...(resolved !== undefined && { mappedPath: resolved }),
      reason: resolved !== undefined ? 'mapped-directory-unusable' : 'no-mapping-for-executable'
    })
  }
}

/**
 * A usable data directory must be readable, writable, and searchable. This is
 * shared with v1-to-v2 migration path selection so both startup paths enforce
 * the same filesystem bar.
 */
export function isUsableDataDir(value: string): boolean {
  try {
    if (!fs.statSync(value).isDirectory()) return false
    fs.accessSync(value, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}
