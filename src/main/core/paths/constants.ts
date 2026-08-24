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
//   - src/main/core/preboot/userDataLocation.ts      → uses resolveDevUserDataPath

import os from 'node:os'
import path from 'node:path'

import { app } from 'electron'

export const CHERRY_HOME_DIRNAME = '.cherrystudio'
export const CHERRY_HOME = path.join(os.homedir(), CHERRY_HOME_DIRNAME)
export const BOOT_CONFIG_PATH = path.join(CHERRY_HOME, 'boot-config.json')

const DEFAULT_DEV_USER_DATA_SUFFIX = 'Dev'

// The suffix is concatenated into directory names, so it must stay a single
// path component: separators, drive colons, and control/Windows-forbidden
// characters could normalize the dev directories back onto the packaged ones
// (e.g. `/../CherryStudio`). Trailing dots are rejected separately — Windows
// strips them, aliasing `CherryStudio.` (from suffix `.`) onto the packaged
// `CherryStudio` directory. Anything a filesystem accepts inside a single
// component — spaces, non-ASCII — stays valid.
const FORBIDDEN_DEV_USER_DATA_SUFFIX = /[\\/:*?"<>|]|\p{Cc}/u

/**
 * Dev-instance directory suffix (`CherryStudio` → `CherryStudioDev`),
 * overridable via CS_DEV_USER_DATA_SUFFIX.
 *
 * Blank values fall back to the default; a value that is not a single path
 * component aborts startup instead, because falling back would silently merge
 * a profile meant to be isolated into the shared `Dev` one. Throwing is also
 * the only way to report this: @logger is unavailable here, since
 * LoggerService consumes LOGS_DIR from this file.
 */
function resolveDevUserDataSuffix(): string {
  const configured = process.env.CS_DEV_USER_DATA_SUFFIX?.trim()
  if (!configured) return DEFAULT_DEV_USER_DATA_SUFFIX
  if (FORBIDDEN_DEV_USER_DATA_SUFFIX.test(configured) || configured.endsWith('.')) {
    throw new Error(
      `CS_DEV_USER_DATA_SUFFIX ${JSON.stringify(configured)} must be a single path component ` +
        '(no path separator, drive colon, Windows-reserved character or trailing dot).'
    )
  }
  return configured
}

/**
 * Dev-instance userData directory (`…/CherryStudio` → `…/CherryStudioDev`).
 * Applied by `core/preboot/userDataLocation.ts` and — on Windows and Linux,
 * where logs live inside userData — by the logs diversion below, so both
 * derive from one definition.
 */
export function resolveDevUserDataPath(): string {
  return app.getPath('userData') + resolveDevUserDataSuffix()
}

// Divert dev logs BEFORE the app.getPath('logs') call below caches Electron's
// default. That default never sees the dev userData suffix — on macOS it
// derives from the app *name* (~/Library/Logs/CherryStudio), elsewhere from
// the not-yet-suffixed userData — so without this a dev run would interleave
// its logs with a packaged install's.
if (!app.isPackaged) {
  app.setAppLogsPath(
    process.platform === 'darwin'
      ? app.getPath('logs') + resolveDevUserDataSuffix()
      : path.join(resolveDevUserDataPath(), 'logs')
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
