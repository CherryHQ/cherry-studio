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
import { getNormalizedExecutablePath, isUsableDataDir } from '@main/core/preboot/userDataLocation'
import { bootConfigService } from '@main/data/bootConfig'
import { app } from 'electron'

import { evaluateCandidateVersion } from './versionPolicy'

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
  /** {userData}/migration-diagnostics-v2.json — active crash-safe migration diagnostics journal. */
  readonly diagnosticsJournalFile: string

  // ── Derived from cherryHome ──

  /** {cherryHome}/config/config.json — v1 legacy config file. */
  readonly legacyConfigFile: string

  // ── Build-time paths ──

  /** Drizzle migration scripts folder (resolved per app.isPackaged). */
  readonly migrationsFolder: string
}

export interface MigrationPathsResult {
  paths: MigrationPaths
  /** Fixed, path-free role describing how the final userData directory was selected. */
  directorySelectionRole: MigrationDirectorySelectionRole
  /** Whether userData was redirected from its Electron default (requires relaunch for path registry consistency). */
  userDataChanged: boolean
  /**
   * Non-null when the legacy config.json contains a custom path that is
   * currently inaccessible (directory missing or not writable). The caller
   * should warn the user — the data may live on an unmounted external drive.
   * When set, `paths.userData` has fallen back to the Electron default.
   */
  inaccessibleLegacyPath: string | null
  /**
   * Whether the FINAL resolved `paths.userData` actually contains v1 data
   * (version.log / Chromium storage / non-empty electron-store config).
   *
   * Computed as a pure property of the resolved directory — NOT a side effect
   * of "did we redirect" — so it survives boot-config short-circuits and
   * relaunches. The engine reads it in `needsMigration()` to avoid
   * `markCompleted()`-locking a directory that plainly holds v1 data whose
   * markers the narrower electron-store probe misses.
   */
  legacyDataConfirmed: boolean
  /**
   * The recovered v1 data directory to surface on the introduction screen.
   * Set only when a non-default directory was auto-selected by the fuzzy
   * fallback (B1). Absent for exact/boot-config hits and the default path.
   */
  dataLocation?: string
}

export type MigrationDirectorySelectionRole =
  | 'current'
  | 'boot_config'
  | 'legacy_exact'
  | 'legacy_fuzzy_eligible'
  | 'legacy_fuzzy_blocked'
  | 'default'
  | 'unknown'

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
  let dataLocation: string | undefined
  let directorySelectionRole: MigrationDirectorySelectionRole = 'default'

  const exe = getNormalizedExecutablePath()
  const bootConfigEntry = bootConfigService.get('app.user_data_path')?.[exe]

  // ── Front gate P: split the boot-config short-circuit ──
  //
  // resolveUserDataLocation() (preboot) has already run: if a boot-config
  // entry existed and was VALID, it setPath'd userData to it; if it existed
  // but was INVALID, it silently fell through to the Electron default.
  if (bootConfigEntry) {
    directorySelectionRole = 'boot_config'
    if (isUsableDataDir(bootConfigEntry)) {
      // Valid → current userData already IS the target. Skip legacy probing.
      logger.info('Boot-config userData entry present and valid, skipping legacy detection', { exe })
    } else {
      // Present but inaccessible (unmounted drive / removed / not
      // read-writable). Proceeding on the default would markCompleted-lock
      // migration there; surface it so the gate shows the 3-option dialog.
      inaccessibleLegacyPath = bootConfigEntry
      logger.warn('Boot-config userData entry present but inaccessible', { exe, bootConfigEntry, currentUserData })
    }
  } else {
    // No boot-config entry → first v2 launch for this exe. Read the legacy
    // v1 config and select the best userData directory.
    const entries = readLegacyEntries(legacyConfigFile, exe)
    const hasExactEntry = entries.some((entry) => sameLocation(entry.executablePath, exe))
    const decision = selectLegacyUserData({
      currentUserData,
      entries,
      currentExe: exe,
      probe: {
        isUsableDir: isUsableDataDir,
        hasV1Data,
        hasValidSqlite,
        versionOk: (dir) => evaluateCandidateVersion(dir, app.getVersion()).check.outcome !== 'block',
        mtimeOf: dirMtime
      }
    })

    switch (decision.kind) {
      case 'redirect': {
        directorySelectionRole = hasExactEntry
          ? 'legacy_exact'
          : decision.notice
            ? 'legacy_fuzzy_eligible'
            : 'legacy_fuzzy_blocked'
        // Redirect userData for Chromium and external consumers, and pre-write
        // boot-config so the next launch resolves it without this fallback.
        app.setPath('userData', decision.target)
        currentUserData = decision.target
        userDataChanged = true
        pinUserDataPath(decision.target)

        if (decision.notice) dataLocation = decision.target
        logger.info('Legacy userData recovered and applied', { exe, target: decision.target, notice: decision.notice })
        break
      }
      case 'inaccessible':
        directorySelectionRole = hasExactEntry ? 'legacy_exact' : 'unknown'
        inaccessibleLegacyPath = decision.path
        logger.warn('Legacy userData path inaccessible, prompting user', { path: decision.path, currentUserData })
        break
      case 'keep':
        directorySelectionRole = 'current'
        logger.info('Current userData already V2-initialized (non-empty sqlite), keeping it')
        break
      case 'default':
        directorySelectionRole = hasExactEntry ? 'legacy_exact' : hasV1Data(currentUserData) ? 'current' : 'default'
        // No recoverable legacy data — keep the Electron default; normal flow.
        break
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
    diagnosticsJournalFile: path.join(currentUserData, 'migration-diagnostics-v2.json'),
    legacyConfigFile,
    migrationsFolder: app.isPackaged
      ? path.join(process.resourcesPath, MIGRATIONS_BASE_PATH)
      : path.join(__dirname, '../../', MIGRATIONS_BASE_PATH)
  })

  // legacyDataConfirmed is a PURE property of the FINAL userData — not a
  // side effect of "did we redirect". This one line covers boot-config hit,
  // redirect, and default alike, and is immune to which launch this is. The
  // engine reads it in needsMigration() to avoid markCompleted-locking a dir
  // that plainly holds v1 data. The inaccessible variants above fell back to
  // an empty default, so this correctly reports false for them.
  const legacyDataConfirmed = hasV1Data(paths.userData)

  return {
    paths,
    userDataChanged,
    inaccessibleLegacyPath,
    legacyDataConfirmed,
    directorySelectionRole,
    dataLocation
  }
}

// ── Legacy userData selection ───────────────────────────────────────────

/** One `{executablePath, dataPath}` record from v1 config.json's appDataPath. */
export interface LegacyEntry {
  executablePath: string
  dataPath: string
}

/**
 * Injected filesystem/version probes for `selectLegacyUserData`, so the pure
 * selection logic is unit-testable without touching disk or Electron.
 */
export interface SelectionProbe {
  /** Directory is usable: isDirectory ∧ read/write/enter (isUsableDataDir). */
  isUsableDir(dir: string): boolean
  /** Directory holds recognizable v1 data (version.log / Chromium storage / config keys). */
  hasV1Data(dir: string): boolean
  /** Directory already holds a non-empty cherrystudio.sqlite (A0 guard). */
  hasValidSqlite(dir: string): boolean
  /** Directory's version.log clears the v1→v2 upgrade gate. */
  versionOk(dir: string): boolean
  /** Directory mtime (ms) for the "most recently used" tie-break. */
  mtimeOf(dir: string): number
}

export type SelectionResult =
  /** A0: current userData already V2-ized — keep it, do not redirect. */
  | { kind: 'keep' }
  /** A1 / B1 / B2: redirect userData to `target`. `notice` = show the location on the intro screen (B1 only). */
  | { kind: 'redirect'; target: string; notice: boolean }
  /** A1-inaccessible / B3: a recorded custom dir is unreachable — prompt the user. */
  | { kind: 'inaccessible'; path: string }
  /** B4 / no-op: keep the current (default) directory and run the normal flow. */
  | { kind: 'default' }

/**
 * Pure v1 userData selection. Decides, from the current userData plus the
 * legacy config entries, whether to keep, redirect, prompt, or fall through.
 *
 * Order (first hit wins):
 *   A0  current userData has a non-empty sqlite            → keep
 *   A1  exact exe→dir mapping (authoritative, no fuzzing)  → redirect | inaccessible
 *   B1  eligible (usable ∧ v1 data ∧ versionOk) dirs       → redirect newest (notice)
 *   B2  candidate (usable ∧ v1 data) but version-blocked   → redirect newest (gate blocks)
 *   B3  no candidate but a recorded dir is unreachable     → inaccessible
 *   B4  nothing recoverable                                → default
 */
export function selectLegacyUserData(input: {
  currentUserData: string
  entries: LegacyEntry[]
  currentExe: string
  probe: SelectionProbe
}): SelectionResult {
  const { currentUserData, entries, currentExe, probe } = input

  // A0 — never abandon an already-V2-ized current directory for a fuzzy guess.
  if (probe.hasValidSqlite(currentUserData)) {
    return { kind: 'keep' }
  }

  // A1 — an explicit exe→dir mapping is authoritative; short-circuit BEFORE
  // any fuzzy fallback. Even when the mapped dir is empty or version-stale we
  // do NOT "helpfully" recover another entry — that reintroduces the guess A1
  // exists to prevent. migrate/block/fresh is decided downstream by the
  // version gate + needsMigration.
  const exactEntry = entries.find((e) => sameLocation(e.executablePath, currentExe))
  if (exactEntry) {
    if (!probe.isUsableDir(exactEntry.dataPath)) {
      return { kind: 'inaccessible', path: exactEntry.dataPath }
    }
    return sameLocation(exactEntry.dataPath, currentUserData)
      ? { kind: 'default' }
      : { kind: 'redirect', target: exactEntry.dataPath, notice: false }
  }

  // B — fuzzy fallback over all candidate dirs (default ∪ entry dataPaths).
  const dirs = dedupeLocations([currentUserData, ...entries.map((e) => e.dataPath)])
  const candidates = dirs.filter((d) => probe.isUsableDir(d) && probe.hasV1Data(d))

  // B1 — eligible dirs (also version-ok): pick the most recently used.
  const eligible = candidates.filter((d) => probe.versionOk(d))
  if (eligible.length > 0) {
    const target = mostRecent(eligible, probe)
    return sameLocation(target, currentUserData) ? { kind: 'default' } : { kind: 'redirect', target, notice: true }
  }

  // B2 — candidates exist but none is version-eligible: still redirect so the
  // existing version gate can block using the dir's own version.log.
  if (candidates.length > 0) {
    const target = mostRecent(candidates, probe)
    return sameLocation(target, currentUserData) ? { kind: 'default' } : { kind: 'redirect', target, notice: false }
  }

  // B3 — no candidate, but a recorded dir is unreachable (unmounted / removed
  // / not read-writable). Prompt rather than silently start fresh on default.
  const unreachable = entries
    .map((e) => e.dataPath)
    .find((d) => !sameLocation(d, currentUserData) && !probe.isUsableDir(d))
  if (unreachable) {
    return { kind: 'inaccessible', path: unreachable }
  }

  // B4 — nothing to recover.
  return { kind: 'default' }
}

/**
 * Pin the current executable to `userData` in boot-config so
 * `resolveUserDataLocation()` resolves it directly on the next launch (no
 * legacy-config fallback, no re-prompt). Shared by the redirect path and the
 * gate's "continue on the default directory" recovery choice.
 *
 * Persists **strictly** (`persist()` THROWS on write failure) rather than
 * best-effort: the next launch depends on this write, so a silent failure would
 * relaunch into the OLD directory and loop (or make migrated data appear lost).
 * Callers in `runV2MigrationGate()` route the throw to a fatal error dialog.
 */
export function pinUserDataPath(userData: string): void {
  const exe = getNormalizedExecutablePath()
  const current = bootConfigService.get('app.user_data_path') ?? {}
  bootConfigService.set('app.user_data_path', { ...current, [exe]: userData })
  bootConfigService.persist()
}

// ── Private helpers ─────────────────────────────────────────────────────

/**
 * Read the legacy v1 config.json and return every recorded
 * `{executablePath, dataPath}` entry. Never throws — returns `[]` on any I/O
 * error, parse failure, or missing field.
 *
 * Two historical shapes:
 *   - String `{ "appDataPath": "/path" }` (old, applies to ALL executables) →
 *     synthesized into a single entry keyed by the CURRENT exe, so it hits the
 *     A1 authoritative branch and preserves the "applies to all exes" meaning.
 *   - Array `{ "appDataPath": [{ executablePath, dataPath }, ...] }` → returned
 *     verbatim for exact-match + fuzzy enumeration.
 */
export function readLegacyEntries(configFile: string, currentExe: string): LegacyEntry[] {
  let raw: string
  try {
    if (!fs.existsSync(configFile)) return []
    raw = fs.readFileSync(configFile, 'utf-8')
  } catch {
    return []
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }

  if (typeof parsed !== 'object' || parsed === null) return []
  const appDataPath = (parsed as Record<string, unknown>).appDataPath

  // String form: applied to all executables → synthesize an exact entry.
  if (typeof appDataPath === 'string' && appDataPath.length > 0) {
    return [{ executablePath: currentExe, dataPath: appDataPath }]
  }

  // Array form: return each well-formed entry verbatim.
  if (Array.isArray(appDataPath)) {
    const entries: LegacyEntry[] = []
    for (const entry of appDataPath) {
      if (
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as Record<string, unknown>).executablePath === 'string' &&
        typeof (entry as Record<string, unknown>).dataPath === 'string'
      ) {
        const { executablePath, dataPath } = entry as LegacyEntry
        if (dataPath.length > 0) entries.push({ executablePath, dataPath })
      }
    }
    return entries
  }

  return []
}

/**
 * Whether a directory holds recognizable v1 data. Multi-marker on purpose:
 * pre-1.7 directories have no version.log, so we also accept Chromium storage
 * (IndexedDB + Local Storage) or a non-empty electron-store config.json. This
 * lets old dirs be redirected → blocked-with-"upgrade first" instead of being
 * mistaken for an empty dir and silently skipped.
 */
function hasV1Data(dir: string): boolean {
  if (fs.existsSync(path.join(dir, 'version.log'))) return true
  if (fs.existsSync(path.join(dir, 'IndexedDB')) && fs.existsSync(path.join(dir, 'Local Storage'))) return true
  return configHasKeys(path.join(dir, 'config.json'))
}

/** Whether config.json parses to a non-empty object (not just `{}`). */
function configHasKeys(configFile: string): boolean {
  try {
    const parsed = JSON.parse(fs.readFileSync(configFile, 'utf-8'))
    return typeof parsed === 'object' && parsed !== null && Object.keys(parsed).length > 0
  } catch {
    return false
  }
}

/**
 * Whether a directory already holds a *non-empty* cherrystudio.sqlite. Mirrors
 * the DB layer's integrity gate (MigrationDbService.ensureDatabaseIntegrity,
 * which unlinks 0-byte files): a leftover 0-byte sqlite must NOT count as
 * V2-ized, or A0 would short-circuit fuzzy recovery only for the DB layer to
 * delete the file moments later — locking migration on the empty default.
 */
function hasValidSqlite(dir: string): boolean {
  try {
    const stat = fs.statSync(path.join(dir, DB_NAME))
    return stat.isFile() && stat.size > 0
  } catch {
    return false
  }
}

/** Directory mtime in ms, or 0 when unreadable (for the recency tie-break). */
function dirMtime(dir: string): number {
  try {
    return fs.statSync(dir).mtimeMs
  } catch {
    return 0
  }
}

/** Pick the directory with the greatest mtime; ties keep the first (stable). */
function mostRecent(dirs: string[], probe: SelectionProbe): string {
  return dirs.reduce((best, d) => (probe.mtimeOf(d) > probe.mtimeOf(best) ? d : best))
}

/**
 * Normalize a path for COMPARISON ONLY (dedup / exe & dir equality). Never use
 * the result for setPath/fs — those keep the original verbatim path so Windows
 * paths survive a POSIX test host. Resolves, strips a trailing separator, and
 * lower-cases on Windows (case-insensitive FS).
 */
function normalizeForCompare(p: string): string {
  const resolved = path.resolve(p)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/** Equality of two paths under comparison normalization. */
function sameLocation(a: string, b: string): boolean {
  return normalizeForCompare(a) === normalizeForCompare(b)
}

/** Dedupe by normalized key, preserving the first original (verbatim) path. */
function dedupeLocations(dirs: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const d of dirs) {
    const key = normalizeForCompare(d)
    if (!seen.has(key)) {
      seen.add(key)
      out.push(d)
    }
  }
  return out
}
