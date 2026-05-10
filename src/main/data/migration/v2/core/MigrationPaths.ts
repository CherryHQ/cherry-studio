/**
 * Centralized path registry for the v2 migration system.
 *
 * All migration code MUST use these pre-computed paths instead of calling
 * `app.getPath()` or constructing paths with `path.join()` from scratch.
 *
 * WARNING: Bypassing MigrationPaths and calling `app.getPath('userData')`
 * directly will cause data loss for v1 users who configured a custom
 * userData directory via `~/.cherrystudio/config/config.json`. On the
 * first v2 launch, `app.getPath('userData')` returns the Electron default
 * — not the user's actual data directory — because `resolveUserDataLocation()`
 * has not yet migrated the legacy config into boot-config.json.
 */

import fs from 'node:fs'
import path from 'node:path'

import { loggerService } from '@logger'
import { CHERRY_HOME } from '@main/core/paths/constants'
import { getNormalizedExecutablePath } from '@main/core/preboot/userDataLocation'
import { bootConfigService } from '@main/data/bootConfig'
import { app } from 'electron'

const logger = loggerService.withContext('MigrationPaths')

const DB_NAME = 'cherrystudio.sqlite'
const MIGRATIONS_BASE_PATH = 'migrations/sqlite-drizzle'

/**
 * Pre-computed, frozen path object for the entire migration lifecycle.
 *
 * Resolved once at the migration gate entry by `resolveMigrationPaths()`,
 * then threaded through the engine, context, and every migrator. Consumers
 * read fields directly — no `path.join()` needed.
 */
export interface MigrationPaths {
  // ── Base directories ──

  /** Resolved v1 userData directory (accounts for legacy config.json custom path). */
  readonly userData: string
  /** ~/.cherrystudio — cherry home directory. */
  readonly cherryHome: string

  // ── Derived from userData (pre-computed, consumers use directly) ──

  /** {userData}/cherrystudio.sqlite */
  readonly databaseFile: string
  /** {userData}/Data/KnowledgeBase */
  readonly knowledgeBaseDir: string
  /** {userData}/version.log — v1 VersionService version history log. */
  readonly versionLogFile: string
  /** {userData}/Data/agents.db — legacy standalone agents SQLite location. */
  readonly legacyAgentDbFile: string
  /** {userData}/Data/Files/custom-minapps.json — v1 sidecar with full custom mini-app records (logos stripped from Redux). */
  readonly customMiniAppsFile: string

  // ── Derived from cherryHome ──

  /** {cherryHome}/config/config.json — v1 legacy config file. */
  readonly legacyConfigFile: string

  // ── Build-time paths ──

  /** Drizzle migration scripts folder (resolved per app.isPackaged). */
  readonly migrationsFolder: string
}

export interface MigrationPathsResult {
  paths: MigrationPaths
  /** Whether userData was redirected from its Electron default (requires relaunch for path registry consistency). */
  userDataChanged: boolean
  /**
   * Non-null when the legacy config.json contains a custom path that is
   * currently inaccessible (directory missing or not writable). The caller
   * should warn the user — the data may live on an unmounted external drive.
   * When set, `paths.userData` has fallen back to the Electron default.
   */
  inaccessibleLegacyPath: string | null
}

/**
 * Resolve all migration-critical paths in one shot.
 *
 * Detection logic:
 *   1. Start with the current `app.getPath('userData')` (set by
 *      `resolveUserDataLocation()` in preboot — may be the Electron
 *      default if boot-config.json had no entry).
 *   2. Read `~/.cherrystudio/config/config.json` for a legacy `appDataPath`.
 *   3. If a valid custom path is found and differs from current:
 *      - Call `app.setPath('userData', ...)` so Chromium-level storage
 *        (IndexedDB, localStorage) initializes at the correct location
 *        when `app.whenReady()` fires, and so external code like
 *        BackupManager picks up the right directory.
 *      - Pre-write to boot-config.json so `resolveUserDataLocation()`
 *        finds the entry on the next launch.
 *   3b. If a custom path is found but inaccessible (drive not mounted,
 *       permissions changed): fall back to default, report via
 *       `inaccessibleLegacyPath` so the caller can warn the user.
 *   4. Pre-compute all derived paths from the final userData.
 *   5. Object.freeze and return.
 *
 * Timing: this function is called inside `runV2MigrationGate()`, which
 * runs AFTER `initPathRegistry()` has frozen the path registry. The
 * `app.setPath('userData', ...)` call therefore creates a temporary
 * divergence between the frozen registry (`application.getPath()`) and
 * Electron's runtime path (`app.getPath('userData')`). This is
 * intentional and safe:
 *   - Migration code uses MigrationPaths, not the frozen registry.
 *   - The app always relaunches after migration (or after the
 *     `userDataChanged` edge case), rebuilding the registry correctly.
 *   - `initPathRegistry()` cannot be moved after the migration gate
 *     because other preboot modules and `bootstrap()` depend on it.
 */
export function resolveMigrationPaths(): MigrationPathsResult {
  const legacyConfigFile = path.join(CHERRY_HOME, 'config', 'config.json')
  let currentUserData = app.getPath('userData')
  let userDataChanged = false
  let inaccessibleLegacyPath: string | null = null

  // Check if boot-config.json already has a matching entry. If so,
  // resolveUserDataLocation() already set the correct userData — skip
  // legacy detection entirely.
  const exe = getNormalizedExecutablePath()
  const bootConfigEntry = bootConfigService.get('app.user_data_path')?.[exe]

  if (!bootConfigEntry) {
    // No boot-config entry → first v2 launch for this executable.
    // Check the legacy v1 config.json for a custom appDataPath.
    const legacyPath = readLegacyAppDataPath(legacyConfigFile, exe)

    if (legacyPath) {
      const resolvedLegacy = path.resolve(legacyPath)
      const resolvedCurrent = path.resolve(currentUserData)

      if (resolvedLegacy !== resolvedCurrent) {
        if (isValidDir(legacyPath)) {
          // Redirect userData for Chromium and external consumers.
          app.setPath('userData', legacyPath)
          currentUserData = legacyPath
          userDataChanged = true

          // Pre-write to boot-config.json so resolveUserDataLocation()
          // picks it up on the next launch without needing this fallback.
          const current = bootConfigService.get('app.user_data_path') ?? {}
          bootConfigService.set('app.user_data_path', { ...current, [exe]: legacyPath })
          bootConfigService.flush()

          logger.info('Legacy userData detected and applied', { exe, legacyPath })
        } else {
          // Custom path exists in config but is inaccessible.
          inaccessibleLegacyPath = legacyPath
          logger.warn('Legacy userData path inaccessible, falling back to default', {
            legacyPath,
            currentUserData
          })
        }
      }
    }
  }

  const paths: MigrationPaths = Object.freeze({
    userData: currentUserData,
    cherryHome: CHERRY_HOME,
    databaseFile: path.join(currentUserData, DB_NAME),
    knowledgeBaseDir: path.join(currentUserData, 'Data', 'KnowledgeBase'),
    versionLogFile: path.join(currentUserData, 'version.log'),
    legacyAgentDbFile: path.join(currentUserData, 'Data', 'agents.db'),
    customMiniAppsFile: path.join(currentUserData, 'Data', 'Files', 'custom-minapps.json'),
    legacyConfigFile,
    migrationsFolder: app.isPackaged
      ? path.join(process.resourcesPath, MIGRATIONS_BASE_PATH)
      : path.join(__dirname, '../../', MIGRATIONS_BASE_PATH)
  })

  return { paths, userDataChanged, inaccessibleLegacyPath }
}

// ── Private helpers ─────────────────────────────────────────────────────

/**
 * Read the legacy v1 config.json and extract the custom userData path
 * for the current executable.
 *
 * Handles two historical shapes:
 *   - String: `{ "appDataPath": "/some/path" }` → returned directly
 *     (applies to all executables).
 *   - Array: `{ "appDataPath": [{ executablePath, dataPath }, ...] }` →
 *     looked up by the normalized exe path.
 *
 * Returns `null` on any I/O error, parse failure, missing field, or no
 * matching entry. Never throws.
 */
function readLegacyAppDataPath(configFile: string, normalizedExe: string): string | null {
  let raw: string
  try {
    if (!fs.existsSync(configFile)) return null
    raw = fs.readFileSync(configFile, 'utf-8')
  } catch {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null) return null

  const appDataPath = (parsed as Record<string, unknown>).appDataPath

  // String format: applies to all executables.
  if (typeof appDataPath === 'string' && appDataPath.length > 0) {
    return appDataPath
  }

  // Array format: look up by normalized exe path.
  if (Array.isArray(appDataPath)) {
    for (const entry of appDataPath) {
      if (
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as Record<string, unknown>).executablePath === 'string' &&
        typeof (entry as Record<string, unknown>).dataPath === 'string'
      ) {
        const { executablePath, dataPath } = entry as { executablePath: string; dataPath: string }
        if (executablePath === normalizedExe && dataPath.length > 0) {
          return dataPath
        }
      }
    }
  }

  return null
}

/**
 * Synchronous check: directory exists and is writable.
 */
function isValidDir(p: string): boolean {
  try {
    if (!fs.existsSync(p)) return false
    fs.accessSync(p, fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}
