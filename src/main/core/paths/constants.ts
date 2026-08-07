// EARLIEST path constants for the Electron main process.
//
// CONSTRAINTS:
//   - No business-module dependencies (no @shared / @main / business code).
//   - Only node built-ins and `electron` are allowed.
//   - Electron's `app.getPath()` is safe at this layer: it works at module
//     import time, before `app.whenReady()`. Verified by LoggerService which
//     constructs at module load and consumes LOGS_DIR through this file.
//
// CONSUMERS (all main-process bootstrap services):
//   - src/main/core/logger/LoggerService.ts          → uses LOGS_DIR
//   - src/main/data/bootConfig/BootConfigService.ts  → uses BOOT_CONFIG_PATH
//   - src/main/core/paths/pathRegistry.ts            → re-exposes LOGS_DIR as 'app.logs'
//   - src/main/core/preboot/userDataLocation.ts      → uses resolveDevUserDataSuffix

import os from 'node:os'
import path from 'node:path'

import { app } from 'electron'

export const CHERRY_HOME_DIRNAME = '.cherrystudio'
export const CHERRY_HOME = path.join(os.homedir(), CHERRY_HOME_DIRNAME)
export const BOOT_CONFIG_PATH = path.join(CHERRY_HOME, 'boot-config.json')

const DEFAULT_DEV_USER_DATA_SUFFIX = 'Dev'

// The suffix is concatenated into directory names, so it must stay a single
// portable path component: separators, traversal segments, drive colons, and
// control/Windows-forbidden characters could normalize the dev directories
// back onto the packaged ones (e.g. `/../CherryStudio`). Trailing dots are
// rejected separately — Windows strips them, aliasing `CherryStudio.` (from
// suffix `.`) onto the packaged `CherryStudio` directory.
const VALID_DEV_USER_DATA_SUFFIX = /^[A-Za-z0-9._-]+$/

/**
 * Dev-instance directory suffix (`CherryStudio` → `CherryStudioDev`),
 * overridable via CS_DEV_USER_DATA_SUFFIX. Defined here (the earliest layer)
 * because it is applied twice from one definition: to the logs directory
 * below, and to userData by `core/preboot/userDataLocation.ts`.
 *
 * Values that are not a single portable path component (ASCII letters,
 * digits, `.`, `_`, `-`; no trailing dot) fall back to the default like blank
 * values do. The warning goes through console — @logger is unavailable here
 * because LoggerService itself consumes LOGS_DIR from this file.
 */
export function resolveDevUserDataSuffix(): string {
  const configured = process.env.CS_DEV_USER_DATA_SUFFIX?.trim()
  if (!configured) return DEFAULT_DEV_USER_DATA_SUFFIX
  if (!VALID_DEV_USER_DATA_SUFFIX.test(configured) || configured.endsWith('.')) {
    console.warn(
      `[paths] CS_DEV_USER_DATA_SUFFIX ${JSON.stringify(configured)} is not a portable ` +
        `path component; falling back to "${DEFAULT_DEV_USER_DATA_SUFFIX}"`
    )
    return DEFAULT_DEV_USER_DATA_SUFFIX
  }
  return configured
}

// Divert dev logs BEFORE the app.getPath('logs') call below caches Electron's
// default. That default never sees the dev userData suffix — on macOS it
// derives from the app *name* (~/Library/Logs/CherryStudio), elsewhere from
// the not-yet-suffixed userData — so without this a dev run would interleave
// its logs with a packaged install's.
if (!app.isPackaged) {
  const suffix = resolveDevUserDataSuffix()
  app.setAppLogsPath(
    process.platform === 'darwin' ? app.getPath('logs') + suffix : path.join(app.getPath('userData') + suffix, 'logs')
  )
}

/**
 * Logs directory. Resolves to Electron's platform-standard location:
 *   - macOS:   ~/Library/Logs/<App>/
 *   - Windows: %APPDATA%/<App>/logs
 *   - Linux:   ~/.config/<App>/logs
 * where `<App>` carries the dev suffix in unpackaged runs (see above).
 *
 * Single source of truth — referenced by LoggerService directly and exposed
 * via pathRegistry as the `app.logs` key for `application.getPath()` consumers.
 */
export const LOGS_DIR = app.getPath('logs')
