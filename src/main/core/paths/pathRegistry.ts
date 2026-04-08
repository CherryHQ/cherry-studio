/**
 * Path registry — the single source of truth for all main-process paths.
 *
 * **Read `./README.md` first** for naming conventions, namespace taxonomy,
 * the meaning of the `.` separator, and how to add a new key.
 *
 * Quick reference:
 *   - Format: `namespace.sub.key_name` matching /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/
 *   - Five top-level namespaces: cherry / sys / app / feature / external
 *   - File suffix: `_file` for standalone files (e.g. `app.exe_file`); `.file`
 *     last segment for files inside a namespace with siblings (e.g.
 *     `app.database.file` paired with `app.database.migrations`)
 *
 * **IMPORTANT — file-level constraint**: Do NOT define any object literals
 * other than the registry returned from `buildPathRegistry()` in this file.
 * The ESLint rule `data-schema-key/valid-key` validates EVERY property name
 * with a string-literal key in the file — including those inside function
 * bodies. Helper objects like `{ darwin: '...', win32: '...' }` would trip
 * the rule on `darwin` / `win32`. Helper constants must be `string` or
 * `number` only. If you need a helper object, put it in a separate file.
 */

import os from 'node:os'
import path from 'node:path'

import { isMac, isWin } from '@main/constant'
import { app } from 'electron'

import { CHERRY_HOME, LOGS_DIR } from './constants'

/**
 * Build the frozen path registry. Called exactly once from
 * `Application.bootstrap()`. Must be invoked AFTER all `app.setPath()`
 * calls have completed and BEFORE any lifecycle service starts.
 *
 * Reading paths through `application.getPath(key, filename?)` is the
 * sole supported access pattern; do not import this function from
 * `@main/core/paths`. The deep alias `@main/core/paths/pathRegistry`
 * is reserved for `Application.ts` (and tests that mock the registry).
 */
export function buildPathRegistry() {
  // ============================================================
  // Intermediate vars — hoisted to avoid repeated path.join and to
  // let sub-keys reference their parents directly. Var names use
  // camelCase correspondence to their PATHS key.
  //
  // NOTE: these are `const` bindings of primitives (strings); NOT object
  // literals. Object literals are forbidden in this file (see top comment).
  // ============================================================
  const appUserData = app.getPath('userData')
  const appUserDataData = path.join(appUserData, 'Data')
  const appSession = app.getPath('sessionData')
  const sysTemp = app.getPath('temp')
  const appTemp = path.join(sysTemp, 'CherryStudio')
  const appResources = process.resourcesPath ?? path.join(app.getAppPath(), 'resources')

  // app.database.migrations: in dev, __dirname points to the bundled main's
  // directory (e.g. <project>/out/main/); walking up two levels reaches
  // project root. In packaged mode, migrations live under resources.
  // This mirrors the existing DbService.ts resolution.
  const migrationsDir = app.isPackaged
    ? path.join(process.resourcesPath, 'migrations/sqlite-drizzle')
    : path.join(__dirname, '../../migrations/sqlite-drizzle')

  return Object.freeze({
    // ============================================================
    // A. cherry.* — generic infrastructure under ~/.cherrystudio
    // ============================================================
    'cherry.home': CHERRY_HOME,
    'cherry.bin': path.join(CHERRY_HOME, 'bin'),
    'cherry.config': path.join(CHERRY_HOME, 'config'),

    // ============================================================
    // B. sys.* — operating-system directories
    // ============================================================
    'sys.home': os.homedir(),
    'sys.temp': sysTemp,
    'sys.downloads': app.getPath('downloads'),
    'sys.documents': app.getPath('documents'),
    'sys.desktop': app.getPath('desktop'),
    'sys.music': app.getPath('music'),
    'sys.pictures': app.getPath('pictures'),
    'sys.videos': app.getPath('videos'),
    'sys.appdata': app.getPath('appData'),
    'sys.appdata.autostart': path.join(app.getPath('appData'), 'autostart'), // Linux only

    // ============================================================
    // C. app.* — the Electron application itself
    // ============================================================
    'app.root': app.getAppPath(),
    'app.exe_file': app.getPath('exe'),
    'app.install': path.dirname(app.getPath('exe')),
    'app.logs': LOGS_DIR,
    'app.crash_dumps': app.getPath('crashDumps'),
    'app.session': appSession,
    'app.resources': appResources,
    'app.resources.scripts': path.join(appResources, 'scripts'),
    'app.resources.binaries': path.join(appResources, 'binaries'),
    'app.temp': appTemp,
    'app.userdata': appUserData,
    'app.userdata.data': appUserDataData,
    'app.userdata.cache': path.join(appUserData, 'Cache'),
    'app.database.file': path.join(appUserData, 'cherrystudio.sqlite'),
    'app.database.migrations': migrationsDir,

    // ============================================================
    // D. feature.* — Cherry-owned feature data / config / temp dirs
    //                (physical location is irrelevant; grouped by feature)
    // ============================================================
    // -- MCP feature --
    'feature.mcp': path.join(CHERRY_HOME, 'mcp'),
    'feature.mcp.oauth': path.join(CHERRY_HOME, 'config', 'mcp', 'oauth'),
    'feature.mcp.workspace': path.join(appUserDataData, 'Workspace'),
    // NOTE: feature.mcp.memory_file and feature.memory.db_file (registered
    // further down) are TWO UNRELATED stores, not a typo. The former is the
    // @modelcontextprotocol memory server's knowledge graph JSON
    // (mcpServers/memory.ts); the latter is Cherry's native memory feature
    // SQLite DB (services/memory/MemoryService.ts). Different namespaces,
    // formats (JSON vs SQLite), and purposes (MCP tool state vs long-term
    // conversation memory).
    'feature.mcp.memory_file': path.join(CHERRY_HOME, 'config', 'memory.json'),

    // -- Anthropic OAuth credentials --
    'feature.anthropic.oauth_file': path.join(CHERRY_HOME, 'config', 'oauth', 'anthropic.json'),

    // -- Copilot token (dotfile .copilot_token) --
    'feature.copilot.token_file': path.join(CHERRY_HOME, 'config', '.copilot_token'),

    // -- Trace feature --
    'feature.trace': path.join(CHERRY_HOME, 'trace'),

    // -- OVMS feature (OpenVINO Model Server) --
    'feature.ovms': path.join(CHERRY_HOME, 'ovms'),
    'feature.ovms.ovms': path.join(CHERRY_HOME, 'ovms', 'ovms'),
    'feature.ovms.patch': path.join(CHERRY_HOME, 'ovms', 'patch'),
    'feature.ovms.ovocr': path.join(CHERRY_HOME, 'ovms', 'ovocr'),

    // -- Agents feature --
    'feature.agents.skills': path.join(CHERRY_HOME, 'skills'),
    'feature.agents.skills.temp': path.join(appTemp, 'skill-install'),
    // Claude Code config root directory (parent of feature.agents.claude.skills).
    // Using '.root' suffix (NOT '.home') to distinguish from the 'user root'
    // semantics of cherry.home / sys.home. This is Claude Code's config
    // directory, equivalent to ~/.claude/ but relocated to userData/.claude/
    // to avoid Windows non-ASCII path encoding issues.
    'feature.agents.claude.root': path.join(appUserData, '.claude'),
    'feature.agents.claude.skills': path.join(appUserData, '.claude', 'skills'),
    'feature.agents.channels': path.join(appUserDataData, 'Channels'),

    // -- Files / Notes / Knowledgebase / Memory --
    'feature.files.data': path.join(appUserDataData, 'Files'),
    'feature.notes.data': path.join(appUserDataData, 'Notes'),
    'feature.knowledgebase.data': path.join(appUserDataData, 'KnowledgeBase'),
    'feature.memory.data': path.join(appUserDataData, 'Memory'),
    // Memory feature SQLite DB (see note above re: feature.mcp.memory_file).
    'feature.memory.db_file': path.join(appUserDataData, 'Memory', 'memories.db'),

    // -- OCR Tesseract cache --
    'feature.ocr.tesseract': path.join(appUserData, 'tesseract'),

    // -- Version log (Cherry-owned audit trail of installed/updated versions) --
    // Physical location is under userData (Electron's per-app data dir),
    // but the namespace is feature.* because the file is owned by Cherry's
    // version-tracking feature, not part of the userData layout itself.
    'feature.version_log.file': path.join(appUserData, 'version.log'),

    // -- Feature-owned temp dirs (physical root: app.temp) --
    'feature.backup.temp': path.join(appTemp, 'backup'),
    'feature.cli.temp': path.join(appTemp, 'cli'),
    'feature.dxt.uploads.temp': path.join(appTemp, 'dxt_uploads'),
    'feature.preprocess.temp': path.join(appTemp, 'preprocess'),
    'feature.lan_transfer.temp': path.join(appTemp, 'lan-transfer'),

    // ============================================================
    // E. external.* — third-party tool paths (Cherry is reader/writer,
    //                 NOT the owner; do not delete on uninstall)
    // ============================================================
    'external.openclaw.config': path.join(os.homedir(), '.openclaw'),
    // Obsidian's per-user JSON of registered vaults, located by Obsidian
    // itself in a platform-specific directory. The Linux fallback uses
    // `~/.config/obsidian/`; ObsidianVaultService still owns the
    // XDG_CONFIG_HOME override path when present. We use a nested ternary
    // (NOT an object literal) so the file-level "no object literals"
    // constraint stays satisfied — the ESLint rule walks Property nodes,
    // and a conditional expression has none.
    'external.obsidian.config_file': isWin
      ? path.join(app.getPath('appData'), 'obsidian', 'obsidian.json')
      : isMac
        ? path.join(os.homedir(), 'Library', 'Application Support', 'obsidian', 'obsidian.json')
        : path.join(os.homedir(), '.config', 'obsidian', 'obsidian.json')
  } as const)
}

/** Compile-time type derived from the builder's return type. */
export type PathMap = ReturnType<typeof buildPathRegistry>

/** String-literal union of all registered path keys. */
export type PathKey = keyof PathMap

// ============================================================
// Auto-ensure configuration
// ============================================================
// `Application.getPath()` automatically creates directories on first
// access (lazy auto-ensure with caching). The unified NO_ENSURE list
// below specifies which keys opt out of auto-ensure.
//
// File vs directory detection uses a naming convention:
//   - Keys ending with 'file' are files → caller code ensures
//     `path.dirname(base)` so the parent directory exists.
//   - Other keys are directories → ensure `base` itself.
//
// Constraint: directory keys MUST NOT end with 'file' (avoid terminal
// segments like 'profile' / 'compile'). Enforced by convention + code
// review. README has the full rationale.
// ============================================================

/**
 * Top-level namespaces, auto-derived from PathKey via template literal
 * type distribution. The `${infer Head}.${string}` pattern extracts the
 * segment before the first dot.
 *
 * Given the current PathKey, this resolves to:
 *   'cherry' | 'sys' | 'app' | 'feature' | 'external'
 *
 * Automatically updates if the registry adds a new top-level namespace.
 */
type TopNamespace = PathKey extends `${infer Head}.${string}` ? Head : never

/**
 * Valid entry in the NO_ENSURE list: either a precise PathKey, or a
 * top-level namespace prefix like `'sys.'` / `'external.'` / `'app.'`.
 */
type NoEnsureEntry = PathKey | `${TopNamespace}.`

/**
 * Unified opt-out list for auto-ensure.
 *
 * Entry semantics:
 *   - Ends with `.` → namespace prefix (matches all keys under it, e.g.
 *     `'sys.'` matches `sys.home`, `sys.downloads`, etc.)
 *   - Otherwise → exact PathKey (precise match)
 *
 * Categories currently excluded from auto-ensure:
 *   - `sys.*`: OS-managed directories (home, downloads, appdata…).
 *     Already exist or owned by the OS.
 *   - `external.*`: third-party tool paths (Obsidian, openclaw…).
 *     Cherry only reads/writes, never owns the directory.
 *   - Individual build artifacts (asar bundle, packaged resources, install
 *     dir, executable file): parent dirs are read-only in production;
 *     attempting mkdir would emit a noisy warning.
 *
 * The `satisfies readonly NoEnsureEntry[]` clause enforces that every
 * entry is either a valid PathKey or a valid top-level namespace prefix.
 * Typos like `'app.typo'` or `'notanamespace.'` are caught at typecheck
 * time. Deleting a key from the registry forces an update here too.
 */
const NO_ENSURE = [
  // Namespace prefixes
  'sys.',
  'external.',
  // Individual read-only keys (build artifacts)
  'app.root',
  'app.install',
  'app.exe_file',
  'app.resources',
  'app.resources.scripts',
  'app.resources.binaries',
  'app.database.migrations'
] as const satisfies readonly NoEnsureEntry[]

/**
 * Decide whether to auto-ensure a PathKey's directory on first access.
 * Consumed by `Application.getPath()`. Co-located with the registry so
 * all path-related data and metadata live in one file.
 */
export function shouldAutoEnsure(key: PathKey): boolean {
  return !NO_ENSURE.some((entry) => (entry.endsWith('.') ? key.startsWith(entry) : key === entry))
}
