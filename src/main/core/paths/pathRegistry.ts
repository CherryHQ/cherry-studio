/**
 * Path registry — single source of truth for all main-process paths.
 * See `./README.md` for naming conventions and namespace taxonomy.
 *
 * Default to `feature.*` for new keys; cherry/sys/app are effectively closed.
 *
 * **File constraint**: No object literals besides the registry itself — the
 * ESLint rule `data-schema-key/valid-key` validates every string-keyed property.
 * Helper constants must be primitives; put helper objects in a separate file.
 */

import os from 'node:os'
import path from 'node:path'

import { isMac, isWin } from '@main/constant'
import { app } from 'electron'

import { CHERRY_HOME, LOGS_DIR } from './constants'

/**
 * Build the frozen path registry. Called once during preboot (after
 * `app.setPath('userData', ...)`, before `app.whenReady()`).
 *
 * Every value must be resolvable in preboot — only sync Electron APIs,
 * `process.resourcesPath`, and Node built-ins. No service dependencies.
 *
 * Access via `application.getPath(key, filename?)` only; do not import
 * this function directly (reserved for Application.ts and tests).
 */
export function buildPathRegistry() {
  // Intermediate vars (primitives only — no object literals in this file).
  const appUserData = app.getPath('userData')
  const appUserDataData = path.join(appUserData, 'Data')
  const appSession = app.getPath('sessionData')
  const sysTemp = app.getPath('temp')
  const appTemp = path.join(sysTemp, 'CherryStudio')
  // electron-builder `extraResources` output — distinct from appRootResources
  const appExtraResources = process.resourcesPath
  // `resources/` inside asar (bundled assets) — distinct from appExtraResources
  const appRootResources = path.join(app.getAppPath(), 'resources')

  return Object.freeze({
    // -- A. cherry.* — ~/.cherrystudio infrastructure --
    'cherry.home': CHERRY_HOME,
    'cherry.bin': path.join(CHERRY_HOME, 'bin'),
    'cherry.config': path.join(CHERRY_HOME, 'config'),

    // -- B. sys.* — OS directories (prefer app.* or cherry.* for Cherry-owned paths) --
    'sys.home': os.homedir(),
    'sys.temp': sysTemp, // OS-wide; prefer app.temp for Cherry-specific temp
    'sys.downloads': app.getPath('downloads'),
    'sys.documents': app.getPath('documents'),
    'sys.desktop': app.getPath('desktop'),
    'sys.music': app.getPath('music'),
    'sys.pictures': app.getPath('pictures'),
    'sys.videos': app.getPath('videos'),
    'sys.appdata': app.getPath('appData'), // OS root; use app.userdata for Cherry-owned
    'sys.appdata.autostart': path.join(app.getPath('appData'), 'autostart'), // Linux only

    // -- C. app.* — the Electron application itself --
    'app.root': app.getAppPath(), // app code; asar in packaged mode
    // ⚠ app.root.resources (asar-bundled) vs app.extra_resources (electron-builder extraResources) are DIFFERENT locations.
    'app.root.resources': appRootResources,
    'app.root.resources.scripts': path.join(appRootResources, 'scripts'),
    'app.root.resources.binaries': path.join(appRootResources, 'binaries'),
    'app.exe_file': app.getPath('exe'),
    'app.install': path.dirname(app.getPath('exe')), // directory containing the executable
    'app.logs': LOGS_DIR,
    'app.crash_dumps': app.getPath('crashDumps'),
    'app.session': appSession,
    'app.session.cache': path.join(appSession, 'Cache'), // Chromium cache Directory
    'app.extra_resources': appExtraResources, // electron-builder extraResources output root
    'app.temp': appTemp, // Cherry-specific temp under sys.temp
    'app.userdata': appUserData, // Electron per-app data dir (Cherry-owned)
    'app.userdata.data': appUserDataData,
    'app.database.file': path.join(appUserData, 'cherrystudio.sqlite'),
    // Dev: relative to __dirname; packaged: shipped via extraResources
    'app.database.migrations': app.isPackaged
      ? path.join(appExtraResources, 'migrations/sqlite-drizzle')
      : path.join(__dirname, '../../migrations/sqlite-drizzle'),

    // -- D. feature.* — grouped by feature, physical location is irrelevant --

    // Provider registry data (models.json, providers.json, etc.)
    'feature.provider_registry.data': app.isPackaged
      ? path.join(appExtraResources, 'provider-registry')
      : path.join(__dirname, '../../packages/provider-registry/data'),

    // MCP
    'feature.mcp': path.join(CHERRY_HOME, 'mcp'),
    'feature.mcp.oauth': path.join(CHERRY_HOME, 'config', 'mcp', 'oauth'),
    'feature.mcp.workspace': path.join(appUserDataData, 'Workspace'),
    // MCP memory server's knowledge-graph JSON for the built-in MCP server
    'feature.mcp.memory_file': path.join(CHERRY_HOME, 'config', 'memory.json'),

    // Anthropic OAuth / Copilot token
    'feature.anthropic.oauth_file': path.join(CHERRY_HOME, 'config', 'oauth', 'anthropic.json'),
    'feature.copilot.token_file': path.join(CHERRY_HOME, 'config', '.copilot_token'),

    // Trace
    'feature.trace': path.join(CHERRY_HOME, 'trace'),

    // OVMS (OpenVINO Model Server)
    'feature.ovms': path.join(CHERRY_HOME, 'ovms'),
    'feature.ovms.ovms': path.join(CHERRY_HOME, 'ovms', 'ovms'),
    'feature.ovms.patch': path.join(CHERRY_HOME, 'ovms', 'patch'),
    'feature.ovms.ovocr': path.join(CHERRY_HOME, 'ovms', 'ovocr'),

    // Agents
    'feature.agents.skills.builtin': path.join(appRootResources, 'skills'), // bundled skill templates (read-only)
    'feature.agents.skills': path.join(appUserDataData, 'Skills'), // installed skills storage
    'feature.agents.skills.install.temp': path.join(appTemp, 'skill-install'),
    'feature.agents.claude.root': path.join(appUserData, '.claude'), // Claude Code config (relocated from ~/.claude for Windows compat)
    'feature.agents.claude.skills': path.join(appUserData, '.claude', 'skills'), // symlinks → feature.agents.skills
    'feature.agents.channels': path.join(appUserDataData, 'Channels'),
    'feature.agents.workspaces': path.join(appUserDataData, 'Agents'), // per-agent workspace parent
    'feature.agents.builtin': path.join(appRootResources, 'builtin-agents'), // bundled agent templates (read-only)

    // Files / Notes / Knowledgebase
    'feature.files.data': path.join(appUserDataData, 'Files'),
    'feature.file_processing.results': path.join(appUserDataData, 'Files', 'file-processing'),
    'feature.notes.data': path.join(appUserDataData, 'Notes'),
    'feature.knowledgebase.data': path.join(appUserDataData, 'KnowledgeBase'),

    // OCR
    'feature.ocr.tesseract': path.join(appUserData, 'tesseract'),

    // Version log
    'feature.version_log.file': path.join(appUserData, 'version.log'),

    // Protocol deep-link (Linux .desktop entry for cherrystudio:// scheme)
    'feature.protocol.desktop_entries': path.join(os.homedir(), '.local', 'share', 'applications'),

    // Feature-owned temp dirs (all under app.temp)
    'feature.backup.temp': path.join(appTemp, 'backup'),
    'feature.cli.temp': path.join(appTemp, 'cli'),
    'feature.dxt.uploads.temp': path.join(appTemp, 'dxt_uploads'),
    'feature.preprocess.temp': path.join(appTemp, 'preprocess'),
    'feature.lan_transfer.temp': path.join(appTemp, 'lan-transfer'),
    // FileManager's `withTempCopy` escape hatch parent dir; each call mkdtemps a
    // unique sub-directory under here.
    'feature.files.tempcopy.temp': path.join(appTemp, 'files-tempcopy'),

    // -- E. external.* — third-party tool paths (Cherry reads/writes, does NOT own) --
    'external.openclaw.config': path.join(os.homedir(), '.openclaw'),
    // Nested ternary (not object literal) to satisfy file-level ESLint constraint
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

// -- Auto-ensure configuration --
// Application.getPath() auto-creates directories on first access.
// Keys ending with 'file' → ensure parent dir; others → ensure dir itself.
// Directory keys MUST NOT end with 'file' (see README).

/** Auto-derived top-level namespace union. */
type TopNamespace = PathKey extends `${infer Head}.${string}` ? Head : never

/** NO_ENSURE entry: exact PathKey or namespace prefix like `'sys.'`. */
type NoEnsureEntry = PathKey | `${TopNamespace}.`

/**
 * Keys that opt out of auto-ensure: OS dirs (`sys.*`), third-party
 * paths (`external.*`), and read-only build artifacts.
 * Type-checked — typos or stale keys fail at compile time.
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
  'feature.provider_registry.data',
  'feature.agents.builtin',
  'feature.agents.skills.builtin'
] as const satisfies readonly NoEnsureEntry[]

/** Whether Application.getPath() should auto-create the directory for this key. */
export function shouldAutoEnsure(key: PathKey): boolean {
  return !NO_ENSURE.some((entry) => (entry.endsWith('.') ? key.startsWith(entry) : key === entry))
}
