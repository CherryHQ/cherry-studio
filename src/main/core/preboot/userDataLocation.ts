import fs from 'node:fs'
import path from 'node:path'

import { loggerService } from '@logger'
import { isLinux, isPortable, isWin } from '@main/core/platform'
import { bootConfigService } from '@main/data/bootConfig'
import { app } from 'electron'

const logger = loggerService.withContext('Preboot')
const DEFAULT_DEV_USER_DATA_SUFFIX = 'Dev'

/**
 * "userData" in this module means Electron's complete OS-level userData
 * directory, including user content, Chromium state, and — on Windows and
 * Linux — application logs (macOS keeps logs in ~/Library/Logs instead).
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
  if (!app.isPackaged) {
    const devPath = app.getPath('userData') + resolveDevUserDataSuffix()
    app.setPath('userData', devPath)
    logger.info('userData set with dev suffix', { devPath })
    return
  }

  const exe = getNormalizedExecutablePath()
  const resolved = bootConfigService.get('app.user_data_path')?.[exe]
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
  }
}

function resolveDevUserDataSuffix(): string {
  return process.env.CS_DEV_USER_DATA_SUFFIX?.trim() || DEFAULT_DEV_USER_DATA_SUFFIX
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
