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
 * **Default to `feature.*` for new keys.** The other four scopes
 * (`cherry.*` / `sys.*` / `app.*` ) describe platform
 * primitives — OS dirs, Electron app structure, Cherry top-level
 * infrastructure, third-party tool paths — and are effectively closed;
 * they rarely grow. Before adding a key under `cherry.*` / `sys.*` /
 * `app.*`, stop and double-check you're not mis-scoping. Application
 * functionality almost always belongs under `feature.*`. See
 * `./README.md` "Default to feature.*" for the full rationale.
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
  // appExtraResources: process.resourcesPath — the electron-builder
  // `extraResources` output dir. Always defined in Electron runtime
  // (typed as `string`, not `string | undefined`). Distinct from
  // appRootResources below — NEVER fall back to it, they point at
  // different physical locations and a silent fallback would write
  // files to the wrong place. See JSDoc on 'app.extra_resources' key
  // for the full distinction.
  const appExtraResources = process.resourcesPath
  // appRootResources: the `resources/` dir INSIDE app.getAppPath()
  // (bundled asar contents, also unpacked via asarUnpack). Distinct
  // from appExtraResources. See JSDoc on 'app.root.resources' key.
  const appRootResources = path.join(app.getAppPath(), 'resources')

  return Object.freeze({
    // ============================================================
    // A. cherry.* — generic infrastructure under ~/.cherrystudio
    // ============================================================
    // Cherry Studio's top-level config directory under the user's OS
    // home (`~/.cherrystudio/`). Contains `config/`, `bin/`, `mcp/`,
    // `trace/`, etc. NOT the same as `sys.home` — which is just the
    // raw OS home directory.
    'cherry.home': CHERRY_HOME,
    'cherry.bin': path.join(CHERRY_HOME, 'bin'),
    'cherry.config': path.join(CHERRY_HOME, 'config'),

    // ============================================================
    // B. sys.* — operating-system directories
    // ============================================================
    // The user's OS home directory (`os.homedir()`). NOT the same as
    // `cherry.home` — which is `~/.cherrystudio/` under the user home.
    // Use `sys.home` when you need the raw home path; use `cherry.home`
    // when you want the Cherry-owned config root.
    'sys.home': os.homedir(),
    // OS-wide temporary directory (`app.getPath('temp')`). Shared
    // across ALL applications on the system. Prefer `app.temp` for
    // anything Cherry-specific so we can clean it up on our own.
    'sys.temp': sysTemp,
    'sys.downloads': app.getPath('downloads'),
    'sys.documents': app.getPath('documents'),
    'sys.desktop': app.getPath('desktop'),
    'sys.music': app.getPath('music'),
    'sys.pictures': app.getPath('pictures'),
    'sys.videos': app.getPath('videos'),
    // ⚠ OS-managed per-user application data ROOT
    // (`app.getPath('appData')`). On macOS this is
    // `~/Library/Application Support/`; on Windows it's `%APPDATA%`.
    // Shared across ALL apps — Cherry should NOT write directly here.
    // Use `app.userdata` (Cherry's Electron-assigned subdirectory)
    // for anything Cherry-owned.
    'sys.appdata': app.getPath('appData'),
    'sys.appdata.autostart': path.join(app.getPath('appData'), 'autostart'), // Linux only

    // ============================================================
    // C. app.* — the Electron application itself
    // ============================================================
    // Path to the running application code (`app.getAppPath()`). In
    // dev mode this is the project root; in packaged mode this is
    // `<install>/Resources/app.asar` (a file, not a directory — read
    // access goes through Electron's fs shim). NOT the same as
    // `app.install` — which is the directory containing the executable.
    'app.root': app.getAppPath(),
    // The `resources/` directory INSIDE the app root
    // (`app.getAppPath() + '/resources/'`). In packaged mode this is
    // inside `app.asar/`; because `resources/**` is listed in
    // `asarUnpack` in electron-builder.yml, the same files also live
    // at `app.asar.unpacked/resources/` for code paths that need a
    // real filesystem (subprocess spawning, native binary execution).
    //
    // ⚠ NOT the same as `app.extra_resources` — which is
    // `process.resourcesPath`, a DIFFERENT physical location that
    // holds electron-builder `extraResources:` output. Rule of thumb:
    //   - File shipped via `extraResources:` → use app.extra_resources
    //   - File bundled via `files:` (inside asar) → use app.root.resources
    'app.root.resources': appRootResources,
    // Subdirectories of app.root.resources (asar-internal bundled assets).
    'app.root.resources.scripts': path.join(appRootResources, 'scripts'),
    'app.root.resources.binaries': path.join(appRootResources, 'binaries'),
    'app.exe_file': app.getPath('exe'),
    // The directory containing the executable file
    // (`path.dirname(app.getPath('exe'))`). In packaged mode this is
    // the installation root (e.g. `/Applications/Cherry Studio.app/
    // Contents/MacOS/` on macOS). NOT the same as `app.root` — which
    // points at the app code (asar bundle in packaged mode).
    'app.install': path.dirname(app.getPath('exe')),
    'app.logs': LOGS_DIR,
    'app.crash_dumps': app.getPath('crashDumps'),
    'app.session': appSession,
    // ⚠ electron-builder `extraResources` output root
    // (`process.resourcesPath`). On macOS this is
    // `<app>/Contents/Resources/`. Contains files listed in the
    // `extraResources:` section of `electron-builder.yml` — currently
    // just `migrations/sqlite-drizzle/` (exposed as
    // `app.database.migrations`).
    //
    // NOT the same as `app.root.resources` above — which is the
    // `resources/` directory INSIDE the app root (asar bundle). See
    // the rule-of-thumb comment on `app.root.resources`.
    'app.extra_resources': appExtraResources,
    // Cherry-specific subdirectory of sys.temp (`{sys.temp}/CherryStudio/`).
    // Use this for all transient Cherry data — it isolates our files
    // from other apps' temp files and lets us clean the whole tree on
    // shutdown/upgrade.
    'app.temp': appTemp,
    // Cherry Studio's Electron-managed per-user data directory
    // (`app.getPath('userData')`). This is a subdirectory of sys.appdata
    // named after this app (macOS: `~/Library/Application Support/
    // CherryStudio/`). Owned by Cherry — safe to read/write/delete
    // freely. NOT the same as `sys.appdata` — which is the OS-level
    // root shared across apps.
    'app.userdata': appUserData,
    'app.userdata.data': appUserDataData,
    'app.userdata.cache': path.join(appUserData, 'Cache'),
    'app.database.file': path.join(appUserData, 'cherrystudio.sqlite'),
    // In dev, __dirname points to the bundled main's directory
    // (e.g. <project>/out/main/); walking up two levels reaches the
    // project root. In packaged mode, migrations are shipped via
    // electron-builder.yml's `extraResources:` section and live under
    // `appExtraResources`. Mirrors the resolution used by DbService.ts.
    'app.database.migrations': app.isPackaged
      ? path.join(appExtraResources, 'migrations/sqlite-drizzle')
      : path.join(__dirname, '../../migrations/sqlite-drizzle'),
    // Provider registry JSON data (models.json, providers.json, etc.)
    // shipped by @cherrystudio/provider-registry. In dev mode, read
    // from the monorepo workspace; in packaged mode, from extraResources.
    'app.provider_registry.data': app.isPackaged
      ? path.join(appExtraResources, 'packages/provider-registry/data')
      : path.join(__dirname, '../../packages/provider-registry/data'),

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
    // Global read/write store for Cherry's built-in and user-installed
    // skills. Physical location: `userData/Data/Skills/{folderName}/`.
    // This is where builtinSkills.ts copies bundled skill templates to,
    // and where SkillService.ts installs user-acquired skills. The
    // symlinks under `feature.agents.claude.skills` point here so the
    // Claude Code SDK can discover them.
    'feature.agents.skills': path.join(appUserDataData, 'Skills'),
    'feature.agents.skills.temp': path.join(appTemp, 'skill-install'),
    // Claude Code config root directory (parent of feature.agents.claude.skills).
    // Using '.root' suffix (NOT '.home') to distinguish from the 'user root'
    // semantics of cherry.home / sys.home. This is Claude Code's config
    // directory, equivalent to ~/.claude/ but relocated to userData/.claude/
    // to avoid Windows non-ASCII path encoding issues.
    'feature.agents.claude.root': path.join(appUserData, '.claude'),
    'feature.agents.claude.skills': path.join(appUserData, '.claude', 'skills'),
    'feature.agents.channels': path.join(appUserDataData, 'Channels'),
    // Per-agent workspace parent directory. BaseService uses
    // `path.join(application.getPath('feature.agents.workspaces'), shortId)`
    // to construct each agent's own workspace under this root.
    'feature.agents.workspaces': path.join(appUserDataData, 'Agents'),

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
  'app.extra_resources',
  'app.root.resources',
  'app.root.resources.scripts',
  'app.root.resources.binaries',
  'app.database.migrations',
  'app.provider_registry.data'
] as const satisfies readonly NoEnsureEntry[]

/**
 * Decide whether to auto-ensure a PathKey's directory on first access.
 * Consumed by `Application.getPath()`. Co-located with the registry so
 * all path-related data and metadata live in one file.
 */
export function shouldAutoEnsure(key: PathKey): boolean {
  return !NO_ENSURE.some((entry) => (entry.endsWith('.') ? key.startsWith(entry) : key === entry))
}
