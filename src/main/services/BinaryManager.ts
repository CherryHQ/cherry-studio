import { execFile, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isWin } from '@main/core/platform'
import { isUserInChina } from '@main/utils/ipService'
import { getBinaryExecutionEnv, getBinaryIsolatedHomeEnv, getBinaryPath } from '@main/utils/process'
import type { BinaryState, ManagedBinary, ToolInstallState } from '@shared/data/preference/preferenceTypes'
import { PRESETS_BINARY_TOOLS, TOOL_KEY_RE, validateManagedBinary } from '@shared/data/presets/binaryTools'

const logger = loggerService.withContext('BinaryManager')

const execFileAsync = promisify(execFile)

interface ReconcileResult {
  installed: string[]
  failed: Array<{ name: string; error: string }>
  skipped: string[]
  stateSaveError?: string
}

// Env vars forwarded from the user shell into the mise subprocess. Deliberately
// excludes auth-token vars (GITHUB_TOKEN, GH_TOKEN, NPM_TOKEN, …) — the README
// commits us to public-registry installs only, and forwarding tokens would
// leak them into mise's error output and disk logs on install failures.
const MISE_PASSTHROUGH_ENV = [
  'PATH',
  'SystemRoot',
  'WINDIR',
  'ComSpec',
  'PATHEXT',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy',
  'NPM_CONFIG_REGISTRY',
  'PIP_INDEX_URL'
]

// Matches a resolved semver version (1.2.3, 1.2.3-rc.1, 1.2.3+build). Used to
// distinguish "concrete version we can persist and compare for equality" from
// floating pins like "latest" / "stable" / "lts" / "1" / "1.2" that mise
// accepts but would always mismatch the resolved version in state.
const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]*)?$/

function isSemverVersion(v: string): boolean {
  return SEMVER_RE.test(v)
}

// True for any pin that does not pick a single concrete version. Used in
// reconcile to skip the equality check when the user requested a floating pin.
function isFloatingVersion(v?: string): boolean {
  return !v || !isSemverVersion(v)
}

const RUNTIME_DEPS: Record<string, string> = { npm: 'node@22', pipx: 'python@3.12' }

const REGISTRY_CACHE_TTL_MS = 10 * 60 * 1000

// Single source of truth for tools shipped inside the app and extracted at
// boot. `internal` marks infrastructure (mise) excluded from the UI probe.
// Binary names are base names; .exe is appended on Windows at use sites.
// NOTE: the build-time list in scripts/download-binaries.js is intentionally
// separate — it additionally carries per-platform download URLs and checksums.
const BUNDLED_TOOLS: Array<{ name: string; binaries: string[]; versionFile: string; internal?: boolean }> = [
  { name: 'mise', binaries: ['mise'], versionFile: '.mise-version', internal: true },
  { name: 'bun', binaries: ['bun'], versionFile: '.bun-version' },
  { name: 'uv', binaries: ['uv', 'uvx'], versionFile: '.uv-version' },
  { name: 'rg', binaries: ['rg'], versionFile: '.rg-version' }
]

const withExe = (name: string): string => (isWin ? `${name}.exe` : name)

// Re-exported from the shared module so existing main-process call sites and
// tests keep importing it from here.
export { validateManagedBinary }

@Injectable('BinaryManager')
@ServicePhase(Phase.Background)
export class BinaryManager extends BaseService {
  private miseBin: string | null = null
  private isolatedEnv: Record<string, string> | null = null
  private registryCache: Array<{ name: string; tool: string }> | null = null
  private registryCacheTime = 0
  private stateLock: Promise<unknown> = Promise.resolve()

  protected async onInit() {
    await this.extractBundledBinaries()
    this.miseBin = this.findMiseBin()
    if (!this.miseBin) {
      logger.warn('mise binary not found, binary management disabled')
      return
    }
    logger.info('mise binary found', { path: this.miseBin })
    this.isolatedEnv = await this.buildIsolatedEnv()
  }

  protected override onAllReady() {
    const prefService = application.get('PreferenceService')
    const predefinedNames = new Set(PRESETS_BINARY_TOOLS.map((t) => t.name))
    const tools = prefService.get('feature.binary.tools')
    const cleaned = tools.filter((t) => !predefinedNames.has(t.name))
    if (cleaned.length < tools.length) {
      void prefService.set('feature.binary.tools', cleaned)
      logger.info('Cleaned predefined tools from custom tools preference', {
        removed: tools.filter((t) => predefinedNames.has(t.name)).map((t) => t.name)
      })
    }
    if (cleaned.length > 0) {
      this.reconcile(cleaned).catch((err) => logger.error('Initial reconcile failed', err))
    }
  }

  /** Current persisted install state. Consumed by the `binary.get_state` route. */
  public getState(): BinaryState {
    return this.loadState()
  }

  /**
   * Directory holding the given tool's binary, for "open in file manager".
   *
   * getBinaryPath() falls back to returning the bare binary name when the tool
   * isn't installed anywhere on disk. `path.dirname('claude')` is `'.'`, which the
   * renderer would then pass to openPath() and end up opening the main-process CWD
   * (root on packaged macOS, dev cwd in dev). Resolve to cherry.bin in that case so
   * the user lands on the managed-binary root instead of somewhere arbitrary.
   */
  public async getToolDir(toolName: string): Promise<string> {
    const binPath = await getBinaryPath(toolName)
    if (!path.isAbsolute(binPath) || !fs.existsSync(binPath)) {
      return application.getPath('cherry.bin')
    }
    return path.dirname(binPath)
  }

  /**
   * Probe which user-facing predefined tools have a bundled copy in cherry.bin.
   *
   * Bundled tools (bun, uv, rg) ship inside the app and are extracted at boot.
   * The UI uses this to distinguish "available (bundled)" from "managed"
   * vs "not installed" — see docs/references/binary-manager/README.md.
   *
   * Returns a map of tool name → version string (from .{name}-version marker)
   * or null when the marker is missing. Absent keys mean the binary is not
   * bundled or hasn't been extracted yet.
   */
  public probeBundled(): Record<string, string | null> {
    const binDir = application.getPath('cherry.bin')
    const result: Record<string, string | null> = {}
    // Skip mise (internal infrastructure); probe by the first expected binary.
    for (const tool of BUNDLED_TOOLS.filter((t) => !t.internal)) {
      if (!fs.existsSync(path.join(binDir, withExe(tool.binaries[0])))) continue
      result[tool.name] = this.readVersionMarker(path.join(binDir, tool.versionFile))
    }
    return result
  }

  private async extractBundledBinaries(): Promise<void> {
    const platformKey = `${process.platform}-${process.arch}`
    const bundledDir = path.join(application.getPath('app.root.resources.binaries'), platformKey)
    const binDir = application.getPath('cherry.bin')
    await fsp.mkdir(binDir, { recursive: true })

    for (const tool of BUNDLED_TOOLS) {
      try {
        const binaries = tool.binaries.map(withExe)
        const versionPath = path.join(bundledDir, tool.versionFile)
        const bundledVersion = this.readVersionMarker(versionPath)
        if (!bundledVersion) {
          logger.error(`Expected bundled ${tool.name} version marker missing`, new Error(`Missing ${versionPath}`))
          continue
        }

        const missingBundled = binaries.filter((bin) => !fs.existsSync(path.join(bundledDir, bin)))
        if (missingBundled.length > 0) {
          logger.error(
            `Expected bundled ${tool.name} binaries missing`,
            new Error(`Missing ${missingBundled.join(', ')} in ${bundledDir}`)
          )
          continue
        }

        // Re-extract when any expected destination binary is missing, even if
        // the first one is present and the version marker matches — guards
        // against partial deletions / AV quarantine of secondary binaries
        // (e.g. uvx alongside uv).
        const installedVersion = this.readVersionMarker(path.join(binDir, tool.versionFile))
        const allDestsPresent = binaries.every((b) => fs.existsSync(path.join(binDir, b)))
        if (allDestsPresent && bundledVersion === installedVersion) continue

        // Copy each binary via dest.tmp + rename so an EBUSY on Windows
        // (binary in use) doesn't leave a half-written file at `dest`.
        for (const bin of binaries) {
          const src = path.join(bundledDir, bin)
          const dest = path.join(binDir, bin)
          const tmp = `${dest}.tmp-${process.pid}`
          await fsp.copyFile(src, tmp)
          if (!isWin) await fsp.chmod(tmp, 0o755)
          await fsp.rename(tmp, dest)
        }
        await fsp.writeFile(path.join(binDir, tool.versionFile), bundledVersion)
        logger.info(`Extracted bundled ${tool.name}`, { binDir, version: bundledVersion })
      } catch (err) {
        // Single-tool failure must not abort init — without this, an EBUSY
        // on (e.g.) bun would prevent mise/uv/rg from being extracted at all.
        logger.error(`Failed to extract bundled ${tool.name}`, err as Error)
      }
    }
  }

  private readVersionMarker(filePath: string): string | null {
    try {
      return fs.readFileSync(filePath, 'utf-8').trim() || null
    } catch {
      return null
    }
  }

  private findMiseBin(): string | null {
    const binaryName = isWin ? 'mise.exe' : 'mise'

    const cherryBin = path.join(application.getPath('cherry.bin'), binaryName)
    if (fs.existsSync(cherryBin)) {
      return cherryBin
    }

    try {
      const cmd = isWin ? 'where' : 'which'
      const result = execFileSync(cmd, [binaryName], { encoding: 'utf-8', timeout: 5000 })
      const systemPath = result.trim().split(/\r?\n/)[0]
      if (systemPath && fs.existsSync(systemPath)) {
        return systemPath
      }
    } catch {
      // not on PATH
    }

    return null
  }

  // Intentionally isolates HOME/XDG to prevent mise from reading user-level
  // configs (.npmrc, .netrc, etc.). Only public registry installs are supported;
  // private registry auth tokens are not passed through.
  // NPM_CONFIG_REGISTRY and PIP_INDEX_URL are passed through and overridden
  // with mirror URLs for China users so that npm/pipx backends work reliably.
  private async buildIsolatedEnv(): Promise<Record<string, string>> {
    const env: Record<string, string> = {}

    for (const key of MISE_PASSTHROUGH_ENV) {
      const val = process.env[key]
      if (val !== undefined) {
        env[key] = val
      }
    }

    // Opt-in GitHub token: users who hit the 60 req/hr unauthenticated API
    // limit (shared NATs, CI, Codespaces) can set CHERRY_GITHUB_TOKEN to
    // raise it to 5000 req/hr. We deliberately do NOT pick up the ambient
    // GITHUB_TOKEN / GH_TOKEN to avoid forwarding the user's general shell
    // token into mise without consent.
    const cherryGhToken = process.env['CHERRY_GITHUB_TOKEN']
    if (cherryGhToken) {
      env['GITHUB_TOKEN'] = cherryGhToken
    }

    const inChina = await isUserInChina().catch(() => false)
    if (inChina) {
      if (!env['NPM_CONFIG_REGISTRY']) {
        env['NPM_CONFIG_REGISTRY'] = 'https://registry.npmmirror.com'
      }
      if (!env['PIP_INDEX_URL']) {
        env['PIP_INDEX_URL'] = 'https://pypi.tuna.tsinghua.edu.cn/simple'
      }
    }

    // HOME/XDG relocation is scoped to this install subprocess only — the shared
    // execution env must keep the user's real HOME (see getBinaryExecutionEnv).
    Object.assign(env, getBinaryExecutionEnv(), getBinaryIsolatedHomeEnv())

    const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') || (isWin ? 'Path' : 'PATH')
    const pathSegments = [
      env['MISE_SHIMS_DIR'],
      this.miseBin ? path.dirname(this.miseBin) : '',
      env[pathKey] || ''
    ].filter(Boolean)
    env[pathKey] = pathSegments.join(path.delimiter)
    if (!isWin) {
      env['PATH'] = env[pathKey]
    }

    if (isWin) {
      env['USERPROFILE'] = env['HOME']
    }

    for (const key of [
      'MISE_DATA_DIR',
      'MISE_CONFIG_DIR',
      'MISE_CACHE_DIR',
      'MISE_STATE_DIR',
      'MISE_SHIMS_DIR',
      'HOME',
      'XDG_CONFIG_HOME',
      'XDG_CACHE_HOME',
      'XDG_STATE_HOME'
    ]) {
      fs.mkdirSync(env[key], { recursive: true })
    }

    return env
  }

  private async runMise(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
    if (!this.miseBin || !this.isolatedEnv) {
      // Both must be set before mise can run. The non-null assertion previously
      // here would have silently fallen back to `process.env`, leaking the
      // user's real shell environment (API keys, HOME, the real mise config)
      // into the mise subprocess — defeating the isolation in buildIsolatedEnv.
      throw new Error('mise binary not available')
    }
    return execFileAsync(this.miseBin, args, { cwd, env: this.isolatedEnv, timeout: 120_000 })
  }

  private withStateLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.stateLock.then(
      () => fn(),
      () => fn()
    )
    this.stateLock = next.catch(() => {})
    return next
  }

  private async isManagedBinaryReady(toolName: string): Promise<boolean> {
    try {
      // `mise which` exits 0 if mise *thinks* the tool is installed; it does
      // not stat the resolved file. If the install dir was manually deleted
      // or AV stripped the exec bit, the file would be missing/unusable
      // while mise still claims success. Verify the resolved path exists
      // (and is executable, on POSIX) before declaring ready.
      const { stdout } = await this.runMise(['which', toolName], os.tmpdir())
      const resolved = stdout.trim().split(/\r?\n/)[0]
      if (!resolved) return false
      await fsp.access(resolved, isWin ? fs.constants.F_OK : fs.constants.X_OK)
      return true
    } catch {
      return false
    }
  }

  private async installWithMise(tool: ManagedBinary): Promise<string> {
    const requested = tool.version || 'latest'
    const backend = tool.tool.split(':')[0]
    const runtime = RUNTIME_DEPS[backend]
    const toolSpec = `${tool.tool}@${requested}`
    const args = ['use', '-g', ...(runtime ? [runtime] : []), toolSpec]

    await this.runMise(args, os.tmpdir())
    await this.runMise(['reshim'], os.tmpdir())

    try {
      const { stdout: lsOut } = await this.runMise(['ls', '--json', tool.tool], os.tmpdir())
      const lsData = JSON.parse(lsOut) as Record<string, Array<{ version?: string }>>
      const entries = Object.values(lsData).flat()
      if (entries.length > 0 && entries[0].version) {
        return entries[0].version
      }
    } catch {
      logger.warn('Failed to query installed version via mise ls', { tool: tool.tool })
    }
    // Never persist a floating sentinel (latest, stable, lts, prefix queries
    // like "1" or "1.2", etc.) as a resolved version — it would break the
    // equality check in reconcile() (existing.version === tool.version) and
    // surface as `vlatest` / `vlts` in the UI. Only real semver versions
    // round-trip; anything else falls back to "unknown" (empty string),
    // which reconcile treats as unpinned via isFloatingVersion().
    return tool.version && isSemverVersion(tool.version) ? tool.version : ''
  }

  private loadState(): BinaryState {
    const statePath = application.getPath('feature.binary.state_file')
    let data: string
    try {
      data = fs.readFileSync(statePath, 'utf-8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { tools: {} }
      }
      // A read error (EACCES, EIO, …) leaves nothing to recover. Throwing here
      // would brick every boot; start empty instead and let reconcile() rebuild.
      logger.error('Failed to read binary state, starting empty', err as Error)
      return { tools: {} }
    }

    try {
      const parsed = JSON.parse(data)
      if (!parsed || typeof parsed !== 'object' || typeof parsed.tools !== 'object' || parsed.tools === null) {
        throw new Error('binary state has unexpected shape')
      }
      const validTools: Record<string, ToolInstallState> = {}
      for (const [key, entry] of Object.entries(parsed.tools)) {
        const e = entry as Record<string, unknown>
        if (
          e &&
          typeof e === 'object' &&
          typeof e.tool === 'string' &&
          typeof e.version === 'string' &&
          TOOL_KEY_RE.test(e.tool)
        ) {
          validTools[key] = e as unknown as ToolInstallState
        } else {
          logger.warn('Discarding malformed tool entry from state', { key })
        }
      }
      return { tools: validTools }
    } catch (err) {
      // Corrupt JSON or wrong shape: back up the bad file before the next
      // saveState() overwrites it, so the failure stays diagnosable.
      logger.error('Binary state file is corrupt, backing up and resetting', err as Error)
      try {
        fs.writeFileSync(statePath + '.corrupt', data)
      } catch (backupErr) {
        logger.warn('Failed to back up corrupt binary state', backupErr as Error)
      }
      return { tools: {} }
    }
  }

  private saveState(state: BinaryState) {
    const statePath = application.getPath('feature.binary.state_file')
    const dir = path.dirname(statePath)
    fs.mkdirSync(dir, { recursive: true })
    const tmp = statePath + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2))
    fs.renameSync(tmp, statePath)
    this.broadcastState(state)
  }

  private broadcastState(state: BinaryState) {
    application.get('IpcApiService').broadcast('binary.state_changed', state)
  }

  async reconcile(tools: ManagedBinary[]): Promise<ReconcileResult> {
    if (!this.miseBin) {
      return { installed: [], failed: [{ name: '*', error: 'mise binary not available' }], skipped: [] }
    }

    return this.withStateLock(async () => {
      const state = this.loadState()
      const result: ReconcileResult = { installed: [], failed: [], skipped: [] }

      for (const tool of tools) {
        try {
          validateManagedBinary(tool)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          logger.warn('Skipping invalid tool from preferences', { name: tool.name, error: msg })
          result.failed.push({ name: tool.name, error: msg })
          continue
        }

        const existing = state.tools[tool.name]
        if (existing && existing.tool === tool.tool && (await this.isManagedBinaryReady(tool.name))) {
          // Skip when the pin is floating (latest, stable, lts, prefix queries
          // like "1" or "1.2") — comparing those literally against the stored
          // resolved version would always mismatch and trigger reinstall every
          // boot. For concrete semvers we still require exact equality.
          if (isFloatingVersion(tool.version) || existing.version === tool.version) {
            result.skipped.push(tool.name)
            continue
          }
        }

        try {
          logger.info('Installing tool', { name: tool.name, tool: tool.tool, version: tool.version || 'latest' })
          const installedVersion = await this.installWithMise(tool)
          // Symmetric with the skip path above: only record the install once the
          // binary is actually runnable, otherwise it falls through to `failed`.
          if (!(await this.isManagedBinaryReady(tool.name))) {
            throw new Error('installed but not runnable')
          }
          state.tools[tool.name] = {
            tool: tool.tool,
            version: installedVersion
          }
          result.installed.push(tool.name)
          logger.info('Tool installed', { name: tool.name, version: installedVersion })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          logger.error('Tool install failed', { name: tool.name, error: msg })
          result.failed.push({ name: tool.name, error: msg })
        }
      }

      try {
        this.saveState(state)
      } catch (err) {
        logger.error('Failed to persist reconcile state', err as Error)
        result.stateSaveError = err instanceof Error ? err.message : String(err)
      }
      this.broadcastReconcileFailures(result.failed)

      return result
    })
  }

  async installTool(tool: ManagedBinary): Promise<{ version: string }> {
    validateManagedBinary(tool)
    if (!this.miseBin) {
      throw new Error('Binary backend not available')
    }

    return this.withStateLock(async () => {
      const version = await this.installWithMise(tool)
      // mise can report success while leaving the binary unrunnable (missing
      // file, AV stripped the exec bit). Verify before persisting so we never
      // record a phantom install — callers (CodeCliService, renderer toast)
      // get the failure instead of a false success.
      if (!(await this.isManagedBinaryReady(tool.name))) {
        throw new Error(`Tool installed but not runnable: ${tool.name}`)
      }
      const state = this.loadState()
      state.tools[tool.name] = {
        tool: tool.tool,
        version
      }
      this.saveState(state)

      return { version }
    })
  }

  private async loadRegistry(): Promise<Array<{ name: string; tool: string }>> {
    if (this.registryCache && Date.now() - this.registryCacheTime < REGISTRY_CACHE_TTL_MS) {
      return this.registryCache
    }

    const { stdout } = await this.runMise(['registry'], os.tmpdir())
    const entries: Array<{ name: string; tool: string }> = []

    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue
      const match = line.match(/^(\S+)\s+(.+)$/)
      if (!match) continue
      const [, name, backends] = match
      const tool = backends.trim().split(/\s+/)[0]
      entries.push({ name, tool })
    }

    this.registryCache = entries
    this.registryCacheTime = Date.now()
    return entries
  }

  async searchRegistry(query: string): Promise<Array<{ name: string; tool: string }>> {
    if (!this.miseBin || !query.trim()) {
      return []
    }

    const registry = await this.loadRegistry()
    const q = query.toLowerCase()
    return registry.filter((entry) => entry.name.toLowerCase().includes(q)).slice(0, 50)
  }

  private broadcastReconcileFailures(failed: ReconcileResult['failed']) {
    if (failed.length === 0 || (failed.length === 1 && failed[0].name === '*')) return
    const names = failed.map((f) => f.name).join(', ')
    application.get('IpcApiService').broadcast('binary.reconcile_failed', names)
  }

  async removeTool(toolName: string): Promise<void> {
    return this.withStateLock(async () => {
      const state = this.loadState()
      const existing = state.tools[toolName]
      if (!existing) return

      if (this.miseBin) {
        try {
          await this.runMise(['unuse', '-g', existing.tool], os.tmpdir())
          // `unuse` only drops the global config entry; the installed versions
          // linger under the isolated data dir (installs/cache/downloads) and
          // accumulate across install/remove cycles. Uninstall them too.
          await this.runMise(['uninstall', '--all', existing.tool], os.tmpdir())
          await this.runMise(['reshim'], os.tmpdir())
        } catch (err) {
          logger.warn('Failed to remove mise tool', {
            name: toolName,
            error: err instanceof Error ? err.message : String(err)
          })
        }
      }

      delete state.tools[toolName]
      this.saveState(state)
    })
  }
}
