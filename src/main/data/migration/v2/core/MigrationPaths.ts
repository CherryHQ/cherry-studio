/**
 * Centralized path registry for the v2 migration system.
 *
 * All migration code MUST use these pre-computed paths instead of calling
 * `app.getPath()` or constructing paths with `path.join()` from scratch.
 *
 * WARNING: Bypassing MigrationPaths and calling `app.getPath('userData')`
 * directly will bypass the preboot path contract. `resolveUserDataLocation()`
 * applies BootConfig and first-v2 legacy `appDataPath` before the migration
 * gate runs, so migration code should consume this frozen path object instead
 * of re-resolving paths ad hoc.
 */

import path from 'node:path'

import { loggerService } from '@logger'
import { CHERRY_HOME } from '@main/core/paths/constants'
import {
  getNormalizedExecutablePath,
  readLegacyAppDataPath,
  validateUserDataDir
} from '@main/core/preboot/userDataLocation'
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
  /** {userData}/Data/Files */
  readonly filesDataDir: string
  /** {userData}/version.log — v1 VersionService version history log. */
  readonly versionLogFile: string
  /** {userData}/Data/agents.db — legacy standalone agents SQLite location. */
  readonly legacyAgentDbFile: string
  /** {userData}/Data/Agents — default v2 Claude Code workspace root. */
  readonly agentWorkspacesDir: string
  /** {userData}/Data/Files/custom-minapps.json — v1 sidecar with full custom miniapp records (logos stripped from Redux). */
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
 *      `resolveUserDataLocation()` in preboot from BootConfig, first-v2
 *      legacy config, portable fallback, or Electron default).
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
 * Timing: this function is called inside `runV2MigrationGate()`, after
 * `resolveUserDataLocation()` has already aligned Electron's userData,
 * the single-instance lock, and the frozen path registry for normal cases.
 * The legacy fallback below remains as a belt-and-suspenders path for older
 * states, and still relaunches if it ever has to redirect userData.
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

  if (bootConfigEntry) {
    const validation = validateUserDataDir(bootConfigEntry)
    if (!validation.ok) {
      inaccessibleLegacyPath = bootConfigEntry
      logger.warn('BootConfig userData path inaccessible, blocking fallback migration', {
        bootConfigEntry,
        reason: validation.reason,
        currentUserData
      })
    }
  } else {
    // No boot-config entry → first v2 launch for this executable.
    // Check the legacy v1 config.json for a custom appDataPath.
    const legacyPath = readLegacyAppDataPath(legacyConfigFile, exe)

    if (legacyPath) {
      const resolvedLegacy = path.resolve(legacyPath)
      const resolvedCurrent = path.resolve(currentUserData)

      if (resolvedLegacy !== resolvedCurrent) {
        const validation = validateUserDataDir(legacyPath)
        if (validation.ok) {
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
            reason: validation.reason,
            currentUserData
          })
        }
      }
    }
  }

  const filesDataDir = path.join(currentUserData, 'Data', 'Files')
  const paths: MigrationPaths = Object.freeze({
    userData: currentUserData,
    cherryHome: CHERRY_HOME,
    databaseFile: path.join(currentUserData, DB_NAME),
    knowledgeBaseDir: path.join(currentUserData, 'Data', 'KnowledgeBase'),
    filesDataDir,
    versionLogFile: path.join(currentUserData, 'version.log'),
    legacyAgentDbFile: path.join(currentUserData, 'Data', 'agents.db'),
    agentWorkspacesDir: path.join(currentUserData, 'Data', 'Agents'),
    customMiniAppsFile: path.join(filesDataDir, 'custom-minapps.json'),
    legacyConfigFile,
    migrationsFolder: app.isPackaged
      ? path.join(process.resourcesPath, MIGRATIONS_BASE_PATH)
      : path.join(__dirname, '../../', MIGRATIONS_BASE_PATH)
  })

  return { paths, userDataChanged, inaccessibleLegacyPath }
}
