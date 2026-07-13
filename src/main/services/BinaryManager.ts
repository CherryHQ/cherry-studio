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
import { regionService } from '@main/services/RegionService'
import { getBinaryIsolatedHomeEnv, getBinarySearchDirs, mergeBinaryExecutionEnv } from '@main/utils/binaryEnv'
import { getBinaryName } from '@main/utils/binaryResolver'
import { findCommandInShellEnv, findExecutable } from '@main/utils/commandResolver'
import { getRawShellEnv } from '@main/utils/shellEnv'
import type { BinaryManifestEntry } from '@shared/data/preference/preferenceTypes'
import {
  isRuntimeDependency,
  PRESETS_BINARY_TOOLS,
  TOOL_KEY_RE,
  TOOL_NAME_RE,
  validateBinaryManifestEntry
} from '@shared/data/presets/binaryTools'
import { CODE_CLI_TOOL_PRESETS } from '@shared/data/presets/codeCliTools'
import type {
  BinaryAvailability,
  BinaryInstallRequest,
  BinaryOperation,
  BinaryResolution,
  BinaryResolutions,
  BinaryToolInventoryEntry,
  BinaryToolSnapshot
} from '@shared/types/binary'
import { Mutex } from 'async-mutex'
import { valid as semverValid } from 'semver'

const logger = loggerService.withContext('BinaryManager')

const execFileAsync = promisify(execFile)

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

const BINARY_INSTALL_PREFERENCE_KEYS = {
  githubMirror: 'feature.binary.install.github_mirror',
  githubToken: 'feature.binary.install.github_token',
  npmRegistry: 'feature.binary.install.npm_registry',
  pipIndexUrl: 'feature.binary.install.pip_index_url',
  verifySignatures: 'feature.binary.install.verify_signatures'
} as const

const RUNTIME_DEPS: Record<string, string> = { npm: 'node@22', pipx: 'python@3.12' }

// Query commands (which/ls/registry/latest) finish in seconds. Installs are a
// different budget entirely: `use` may download a full runtime (node, python)
// plus the package, which routinely exceeds two minutes on slow networks —
// killing it mid-download surfaces as a bogus "install failed".
const MISE_COMMAND_TIMEOUT_MS = 120_000
const MISE_INSTALL_TIMEOUT_MS = 15 * 60_000

const REGISTRY_CACHE_TTL_MS = 10 * 60 * 1000

// `mise latest` for github: backends hits the rate-limited GitHub releases API,
// so lookups stay off the boot path and run with a small concurrency bound.
const LATEST_VERSIONS_CONCURRENCY = 4

function parseInstallUrl(value: string, setting: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error()
    return url.toString().replace(/\/$/, '')
  } catch {
    throw new Error(`${setting} must be a valid HTTP(S) URL`)
  }
}

function toPipxRegistryUrl(indexUrl: string): string {
  return `${indexUrl.replace(/\/+$/, '')}/{}/`
}

function isPathWithin(root: string, candidate: string): boolean {
  const normalizedRoot = isWin ? path.resolve(root).toLowerCase() : path.resolve(root)
  const normalizedCandidate = isWin ? path.resolve(candidate).toLowerCase() : path.resolve(candidate)
  const relative = path.relative(normalizedRoot, normalizedCandidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

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

// Re-exported for main-process callers and tests.
export { validateBinaryManifestEntry }

@Injectable('BinaryManager')
@ServicePhase(Phase.Background)
export class BinaryManager extends BaseService {
  private miseBin: string | null = null
  // Built lazily on first mise invocation, never in onInit(): the isolated env is
  // only ever consumed by runMise() (install/remove/search/query), none of
  // which run during init. buildIsolatedEnv() blocks on a region lookup
  // (regionService.isInChina, for China mirror selection) whose cache is cold on
  // every launch, so building it eagerly put a network round-trip on the
  // Background-phase critical path that gates allReady(), for a value most
  // launches never use. `isolatedEnvPromise` memoizes the in-flight build so
  // concurrent first callers share a single build and a single region lookup.
  private isolatedEnv: Record<string, string> | null = null
  private isolatedEnvPromise: Promise<Record<string, string>> | null = null
  private registryCache: Array<{ name: string; tool: string }> | null = null
  private registryCacheTime = 0
  // Serializes manifest read-modify-write with filesystem mutations so concurrent
  // requests cannot lose ownership entries or interleave mise global changes.
  private readonly mutationMutex = new Mutex()
  // A global mutex serializes mise and manifest changes. This separate guard
  // prevents a same-tool request queued behind it from replacing the operation
  // state that belongs to the request already running or waiting.
  private readonly activeMutations = new Map<
    string,
    | { action: 'install'; request: BinaryInstallRequest; promise: Promise<{ version: string }> }
    | {
        action: 'remove'
        promise: Promise<void>
      }
  >()
  private latestVersionsPromise: Promise<Record<string, string>> | null = null

  protected async onInit() {
    await this.extractBundledBinaries()
    this.miseBin = this.findMiseBin()
    if (!this.miseBin) {
      logger.warn('mise binary not found, binary management disabled')
      return
    }
    logger.info('mise binary found', { path: this.miseBin })
    // isolatedEnv is built lazily on first runMise() — see getIsolatedEnv() and
    // the isolatedEnv field comment. Building it here would block init on a
    // region lookup that nothing in the init path consumes.
  }

  protected override onAllReady() {
    const prefService = application.get('PreferenceService')
    this.registerDisposable(
      prefService.subscribeMultipleChanges(
        [
          BINARY_INSTALL_PREFERENCE_KEYS.githubMirror,
          BINARY_INSTALL_PREFERENCE_KEYS.githubToken,
          BINARY_INSTALL_PREFERENCE_KEYS.npmRegistry,
          BINARY_INSTALL_PREFERENCE_KEYS.pipIndexUrl,
          BINARY_INSTALL_PREFERENCE_KEYS.verifySignatures,
          'app.proxy.mode',
          'app.proxy.url',
          'app.proxy.bypass_rules'
        ],
        () => {
          this.isolatedEnv = null
          this.isolatedEnvPromise = null
        }
      )
    )
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
  private probeBundled(): Record<string, string | null> {
    const binDir = application.getPath('cherry.bin')
    const result: Record<string, string | null> = {}
    // Skip mise (internal infrastructure). Record every shipped executable so
    // aliases such as uvx resolve through the same ownership boundary as uv.
    for (const tool of BUNDLED_TOOLS.filter((t) => !t.internal)) {
      const version = this.readVersionMarker(path.join(binDir, tool.versionFile))
      for (const binary of tool.binaries) {
        if (fs.existsSync(path.join(binDir, getBinaryName(binary)))) result[binary] = version
      }
    }
    return result
  }

  /**
   * Probe which tools resolve on the user's login-shell PATH outside Cherry's
   * managed and bundled directories.
   */
  private async probeSystem(names: string[]): Promise<Record<string, string>> {
    if (names.length === 0) return {}
    const shellEnv = await getRawShellEnv()
    const cherryDirs = [application.getPath('cherry.bin'), application.getPath('feature.binary.data')]

    const entries = await Promise.all(
      names.map(async (name): Promise<[string, string] | null> => {
        const resolved = isWin
          ? findExecutable(name, { extensions: ['.exe', '.cmd', '.bat'], env: shellEnv })
          : await findCommandInShellEnv(name, shellEnv)
        if (!resolved || cherryDirs.some((dir) => isPathWithin(dir, resolved))) return null
        return [name, resolved]
      })
    )
    return Object.fromEntries(entries.filter((entry): entry is [string, string] => entry !== null))
  }

  /**
   * Return one weakly-consistent, main-computed view of management intent, live
   * availability, and session operations. This deliberately does not take the
   * mutation mutex: a slow install must not hide its already-published operation.
   */
  public async getToolSnapshots(requestedNames: string[]): Promise<Record<string, BinaryToolSnapshot>> {
    const manifest = this.getManifest()
    const operations = application.get('CacheService').getShared('feature.binary.install_states') ?? {}
    const intentsByName = new Map(manifest.map((intent) => [intent.name, intent]))
    const candidates = new Map<string, string>()
    const addCandidate = (name: string, tool: string) => {
      if (!candidates.has(name)) candidates.set(name, tool)
    }

    for (const intent of manifest) addCandidate(intent.name, intent.tool)
    for (const preset of PRESETS_BINARY_TOOLS) addCandidate(preset.name, preset.tool)
    for (const preset of CODE_CLI_TOOL_PRESETS) addCandidate(preset.executable, preset.miseTool)
    for (const [name, operation] of Object.entries(operations)) {
      if (operation.status === 'failed' && operation.action === 'install' && operation.intent) {
        addCandidate(name, operation.intent.tool)
      }
    }
    for (const name of requestedNames) addCandidate(name, name)

    const installed: Record<string, Array<{ version?: string; active?: boolean }>> = {}
    if (this.miseBin) {
      try {
        const { stdout } = await this.runMise(['ls', '--json'])
        Object.assign(installed, JSON.parse(stdout) as typeof installed)
      } catch (err) {
        logger.warn('Failed to query installed versions via mise ls', {
          error: err instanceof Error ? err.message : String(err)
        })
      }
    }

    const normalize = (spec: string) => (spec.startsWith('core:') ? spec.slice('core:'.length) : spec)
    for (const [spec] of Object.entries(installed)) {
      const name = normalize(spec).split('@')[0]
      if (isRuntimeDependency(spec)) addCandidate(name, spec)
    }

    const installedFor = (tool: string) => {
      const normalized = normalize(tool)
      const runtimeName = isRuntimeDependency(tool) ? normalized.split('@')[0] : undefined
      return (
        installed[normalized] ??
        (runtimeName
          ? Object.entries(installed).find(([spec]) => normalize(spec).split('@')[0] === runtimeName)?.[1]
          : undefined)
      )
    }
    const names = new Set([...requestedNames, ...intentsByName.keys(), ...Object.keys(operations)])
    for (const [spec] of Object.entries(installed)) {
      const name = normalize(spec).split('@')[0]
      if (isRuntimeDependency(spec)) names.add(name)
    }
    const bundled = this.probeBundled()
    const shimsDir = getBinarySearchDirs()[0]
    const miseEntries = await Promise.all(
      [...names].map(async (name): Promise<[string, { path: string; version?: string }] | null> => {
        const tool = candidates.get(name)
        const entries = tool ? installedFor(tool) : undefined
        if (!entries?.length) return null
        const shimPath = path.join(shimsDir, getBinaryName(name))
        try {
          await fsp.access(shimPath, isWin ? fs.constants.F_OK : fs.constants.X_OK)
        } catch {
          return null
        }
        const version = entries.find((entry) => entry.active)?.version ?? entries.at(-1)?.version
        return [name, { path: shimPath, ...(version ? { version } : {}) }]
      })
    )
    const misePaths = new Map(
      miseEntries.filter((entry): entry is [string, { path: string; version?: string }] => !!entry)
    )
    const system = await this.probeSystem([...names].filter((name) => !misePaths.has(name) && !(name in bundled)))
    const snapshots: Record<string, BinaryToolSnapshot> = {}
    for (const name of names) {
      const mise = misePaths.get(name)
      const availability: BinaryAvailability = mise
        ? {
            source: 'mise',
            tool: candidates.get(name) ?? name,
            path: mise.path,
            ...(mise.version ? { version: mise.version } : {})
          }
        : name in bundled
          ? {
              source: 'bundled',
              path: path.join(application.getPath('cherry.bin'), getBinaryName(name)),
              ...(bundled[name] ? { version: bundled[name] } : {})
            }
          : system[name]
            ? { source: 'system', path: system[name] }
            : { source: 'none' }
      snapshots[name] = {
        name,
        ...(intentsByName.has(name) ? { intent: intentsByName.get(name)! } : {}),
        availability,
        ...(operations[name] ? { operation: operations[name] } : {})
      }
    }
    return snapshots
  }

  /** Resolve each binary once using managed → bundled → system precedence. */
  public async resolveTools(names: string[]): Promise<BinaryResolutions> {
    const uniqueNames = [...new Set(names)]
    if (uniqueNames.length === 0) return {}
    const manifest = this.getManifest()
    const intentsByName = new Map(manifest.map((intent) => [intent.name, intent]))
    const managedVersions = await this.getInstalledVersions(manifest)
    const bundled = this.probeBundled()
    const runtimePaths = Object.fromEntries(
      await Promise.all(
        uniqueNames
          .filter((name) => !intentsByName.has(name) && isRuntimeDependency(name))
          .map(async (name): Promise<[string, string] | null> => {
            const runtimePath = await this.resolveManagedBinaryPath(name)
            return runtimePath ? [name, runtimePath] : null
          })
      ).then((entries) => entries.filter((entry): entry is [string, string] => entry !== null))
    )
    const system = await this.probeSystem(
      uniqueNames.filter((name) => !intentsByName.has(name) && !(name in bundled) && !runtimePaths[name])
    )

    const entries = await Promise.all(
      uniqueNames.map(async (name): Promise<[string, BinaryResolution]> => {
        const intent = intentsByName.get(name)
        if (intent) {
          const managedPath = await this.resolveManagedBinaryPath(name)
          if (managedPath) {
            return [name, { source: 'managed', path: managedPath, version: managedVersions[intent.name] ?? '' }]
          }
        }
        if (runtimePaths[name]) return [name, { source: 'managed', path: runtimePaths[name], version: '' }]

        if (name in bundled) {
          const version = bundled[name] ?? undefined
          const binaryPath = path.join(application.getPath('cherry.bin'), getBinaryName(name))
          return [
            name,
            version ? { source: 'bundled', path: binaryPath, version } : { source: 'bundled', path: binaryPath }
          ]
        }

        const systemPath = system[name] ?? (intent ? (await this.probeSystem([name]))[name] : undefined)
        return [name, systemPath ? { source: 'system', path: systemPath } : { source: 'none' }]
      })
    )
    return Object.fromEntries(entries)
  }

  private async extractBundledBinaries(): Promise<void> {
    const platformKey = `${process.platform}-${process.arch}`
    const bundledDir = path.join(application.getPath('app.root.resources.binaries'), platformKey)
    const binDir = application.getPath('cherry.bin')
    await fsp.mkdir(binDir, { recursive: true })

    for (const tool of BUNDLED_TOOLS) {
      try {
        const binaries = tool.binaries.map((bin) => getBinaryName(bin))
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
    const binaryName = getBinaryName('mise')

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

    const installSettings = application.get('PreferenceService').getMultiple(BINARY_INSTALL_PREFERENCE_KEYS)
    const githubMirror = parseInstallUrl(installSettings.githubMirror, 'GitHub mirror')
    const npmRegistry = parseInstallUrl(installSettings.npmRegistry, 'npm registry')
    const pipIndexUrl = parseInstallUrl(installSettings.pipIndexUrl || env['PIP_INDEX_URL'] || '', 'pip index')
    if (npmRegistry) env['NPM_CONFIG_REGISTRY'] = npmRegistry
    if (pipIndexUrl) {
      env['PIP_INDEX_URL'] = pipIndexUrl
      // mise's pipx backend derives UV_INDEX/PIP_INDEX_URL from this setting,
      // overriding ambient values before invoking uvx/pipx.
      env['MISE_PIPX_REGISTRY_URL'] = toPipxRegistryUrl(pipIndexUrl)
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
    if (installSettings.githubToken) env['GITHUB_TOKEN'] = installSettings.githubToken

    // mise only defaults this when uv is already on PATH. Force bundled uv/uvx
    // for pipx tools so installs do not depend on a separate pipx executable.
    env['MISE_PIPX_UVX'] = '1'

    if (githubMirror) {
      const prefix = githubMirror
      env['MISE_URL_REPLACEMENTS'] = JSON.stringify({
        'https://github.com': `${prefix}/https://github.com`
      })
    }

    if (!installSettings.verifySignatures) {
      env['MISE_AQUA_COSIGN'] = 'false'
      env['MISE_AQUA_SLSA'] = 'false'
      env['MISE_AQUA_MINISIGN'] = 'false'
      env['MISE_AQUA_GITHUB_ATTESTATIONS'] = 'false'
    }

    const inChina = await regionService.isInChina().catch(() => false)
    if (inChina) {
      if (!env['NPM_CONFIG_REGISTRY']) {
        env['NPM_CONFIG_REGISTRY'] = 'https://registry.npmmirror.com'
      }
      if (!env['PIP_INDEX_URL']) {
        const chinaPipIndex = 'https://pypi.tuna.tsinghua.edu.cn/simple'
        env['PIP_INDEX_URL'] = chinaPipIndex
        env['MISE_PIPX_REGISTRY_URL'] = toPipxRegistryUrl(chinaPipIndex)
      }
    }

    // Reuse the shared MISE_*/PATH merge (single source of truth in binaryEnv.ts),
    // prepending mise's own dir so a re-exec'd child mise resolves. HOME/XDG are
    // relocated *after* the merge — this isolation is scoped to the install
    // subprocess only; the shared execution env keeps the user's real HOME.
    const merged = mergeBinaryExecutionEnv(env, this.miseBin ? [path.dirname(this.miseBin)] : [])
    const isolatedHome = getBinaryIsolatedHomeEnv()
    Object.assign(merged, isolatedHome)

    if (isWin) {
      merged['USERPROFILE'] = merged['HOME']
    }

    // Keep directory creation aligned with platform-specific isolated-home keys.
    for (const key of [
      'MISE_DATA_DIR',
      'MISE_CONFIG_DIR',
      'MISE_CACHE_DIR',
      'MISE_STATE_DIR',
      'MISE_SHIMS_DIR',
      ...Object.keys(isolatedHome)
    ]) {
      fs.mkdirSync(merged[key], { recursive: true })
    }

    return merged
  }

  /**
   * Lazily build (and memoize) the isolated mise env on first use. Deferred out
   * of onInit() because buildIsolatedEnv() blocks on a region lookup
   * (regionService.isInChina) that has no place on the startup critical path —
   * see the isolatedEnv field comment. The in-flight promise is cached so
   * concurrent first callers share a single build and a single region lookup; a
   * failed build is not cached, so a later call can retry once a transient cause
   * (e.g. mkdir failure) clears.
   */
  private getIsolatedEnv(): Promise<Record<string, string>> {
    if (this.isolatedEnv) {
      return Promise.resolve(this.isolatedEnv)
    }
    if (!this.isolatedEnvPromise) {
      const building = this.buildIsolatedEnv().then(
        (env) => {
          if (this.isolatedEnvPromise === building) this.isolatedEnv = env
          return env
        },
        (err) => {
          if (this.isolatedEnvPromise === building) this.isolatedEnvPromise = null
          throw err
        }
      )
      this.isolatedEnvPromise = building
    }
    return this.isolatedEnvPromise
  }

  private async runMise(args: string[], opts?: { timeoutMs?: number }): Promise<{ stdout: string; stderr: string }> {
    if (!this.miseBin) {
      // Without mise there is nothing to run. The non-null assertion previously
      // used for the env would have silently fallen back to `process.env`,
      // leaking the user's real shell environment (API keys, HOME, the real
      // mise config) into the mise subprocess — defeating buildIsolatedEnv's
      // isolation. getIsolatedEnv() always resolves a fully-built isolated env.
      throw new Error('mise binary not available')
    }
    const env = await this.getIsolatedEnv()
    const timeoutMs = opts?.timeoutMs ?? MISE_COMMAND_TIMEOUT_MS
    const startedAt = Date.now()
    // cwd is always a throwaway tmp dir so mise never picks up a project-local
    // mise.toml from the main process's working directory.
    try {
      return await execFileAsync(this.miseBin, args, { cwd: os.tmpdir(), env, timeout: timeoutMs })
    } catch (error) {
      if (error instanceof Error) {
        // A timeout kill leaves stderr at whatever progress line mise printed
        // last — worthless as an error headline. Rewrite it; the elapsed check
        // distinguishes our timeout kill from an external kill (OOM, user).
        const killed = (error as { killed?: boolean }).killed === true
        if (killed && Date.now() - startedAt >= timeoutMs) {
          error.message = `mise ${args[0]} timed out after ${Math.round(timeoutMs / 1000)}s — a slow network or a runtime download can exceed the budget; retry or configure a mirror in install settings`
        }
        const stderr = (error as { stderr?: unknown }).stderr
        if (typeof stderr === 'string' && stderr.trim()) {
          const detail = stderr.trim()
          if (!error.message.includes(detail)) error.message = `${error.message}\n${detail}`
        }
      }
      throw error
    }
  }

  private async resolveManagedBinaryPath(toolName: string): Promise<string | null> {
    try {
      // `mise which` exits 0 if mise *thinks* the tool is installed; it does
      // not stat the resolved file. Verify the target before exposing it.
      const { stdout } = await this.runMise(['which', toolName])
      const resolved = stdout.trim().split(/\r?\n/)[0]
      if (!resolved) return null
      await fsp.access(resolved, isWin ? fs.constants.F_OK : fs.constants.X_OK)
      return resolved
    } catch {
      return null
    }
  }

  private async isManagedBinaryReady(toolName: string): Promise<boolean> {
    return (await this.resolveManagedBinaryPath(toolName)) !== null
  }

  private async installWithMise(
    intent: BinaryManifestEntry,
    targetVersion: string | undefined,
    manifest: BinaryManifestEntry[]
  ): Promise<string> {
    const requested = targetVersion ?? intent.requestedVersion ?? 'latest'
    const backend = intent.tool.split(':')[0]
    const defaultRuntime = RUNTIME_DEPS[backend]
    const runtimeName = defaultRuntime?.split('@')[0]
    const ownedRuntime = runtimeName
      ? manifest.find((entry) => {
          const runtimeTool = entry.tool.startsWith('core:') ? entry.tool.slice('core:'.length) : entry.tool
          return isRuntimeDependency(entry.tool) && runtimeTool.split('@')[0] === runtimeName
        })
      : undefined
    let runtime = defaultRuntime
    if (ownedRuntime) {
      const runtimeTool = ownedRuntime.tool.replace(/@[^@]+$/, '')
      const runtimeVersion = ownedRuntime.requestedVersion ?? (await this.getInstalledVersion(runtimeTool))
      runtime = `${runtimeTool}@${runtimeVersion}`
    }
    const toolSpec = `${intent.tool}@${requested}`

    await this.runMise(['use', '-g', ...(runtime ? [runtime] : []), toolSpec], { timeoutMs: MISE_INSTALL_TIMEOUT_MS })
    await this.runMise(['reshim'])
    return this.getInstalledVersion(intent.tool, requested)
  }

  private async getInstalledVersion(tool: string, requested?: string): Promise<string> {
    const { stdout } = await this.runMise(['ls', '--json', tool])
    const entries = Object.values(
      JSON.parse(stdout) as Record<string, Array<{ version?: string; active?: boolean }>>
    ).flat()
    const requestedVersion = requested ? semverValid(requested) : null
    const matching = requestedVersion
      ? entries.find((entry) => semverValid(entry.version) === requestedVersion)
      : (entries.find((entry) => entry.active) ?? (entries.length === 1 ? entries[0] : undefined))
    if (!matching?.version) {
      throw new Error(`mise did not report an installed version for ${tool}${requested ? `@${requested}` : ''}`)
    }
    return matching.version
  }

  private async getInstalledVersions(intents: BinaryManifestEntry[]): Promise<Record<string, string>> {
    if (!this.miseBin || intents.length === 0) return {}

    try {
      const { stdout } = await this.runMise(['ls', '--json'])
      const installed = JSON.parse(stdout) as Record<string, Array<{ version?: string; active?: boolean }>>
      return this.getInstalledVersionsFromOutput(intents, installed)
    } catch (err) {
      logger.warn('Failed to query installed versions via mise ls', {
        error: err instanceof Error ? err.message : String(err)
      })
      return {}
    }
  }

  private getInstalledVersionsFromOutput(
    intents: BinaryManifestEntry[],
    installed: Record<string, Array<{ version?: string; active?: boolean }>>
  ): Record<string, string> {
    const versions: Record<string, string> = {}
    const normalize = (spec: string) => (spec.startsWith('core:') ? spec.slice('core:'.length) : spec)
    for (const intent of intents) {
      const normalized = normalize(intent.tool)
      const runtimeName = isRuntimeDependency(intent.tool) ? normalized.split('@')[0] : undefined
      const entries =
        installed[normalized] ??
        (runtimeName
          ? Object.entries(installed).find(([spec]) => normalize(spec).split('@')[0] === runtimeName)?.[1]
          : undefined)
      versions[intent.name] = entries?.find((entry) => entry.active)?.version ?? entries?.at(-1)?.version ?? ''
    }
    return versions
  }

  private async isMiseToolAbsent(tool: string): Promise<boolean> {
    const { stdout } = await this.runMise(['ls', '--json', tool])
    const entries = Object.values(JSON.parse(stdout) as Record<string, Array<{ version?: string }>>).flat()
    return entries.length === 0
  }

  private getManifest(): BinaryManifestEntry[] {
    return application.get('PreferenceService').get('feature.binary.tools')
  }

  private async upsertManifest(intent: BinaryManifestEntry): Promise<void> {
    const manifest = this.getManifest()
    await application
      .get('PreferenceService')
      .set('feature.binary.tools', [...manifest.filter((entry) => entry.name !== intent.name), intent])
    this.invalidateManifestViews()
  }

  private async removeManifest(toolName: string): Promise<void> {
    const manifest = this.getManifest()
    await application.get('PreferenceService').set(
      'feature.binary.tools',
      manifest.filter((entry) => entry.name !== toolName)
    )
    this.invalidateManifestViews()
  }

  private manifestFingerprint(manifest = this.getManifest()): string {
    return manifest
      .map((entry) => `${entry.name}\u0000${entry.tool}\u0000${entry.requestedVersion ?? ''}`)
      .sort()
      .join('\u0001')
  }

  private invalidateManifestViews() {
    application.get('CacheService').deleteShared('feature.binary.latest_versions')
    application.get('IpcApiService').broadcast('binary.availability_changed', undefined)
  }

  private validateInstallRequest(request: BinaryInstallRequest) {
    validateBinaryManifestEntry(request.intent)
    if (request.targetVersion && !TOOL_KEY_RE.test(request.targetVersion)) {
      throw new Error(`Invalid tool version: ${request.targetVersion}`)
    }
    const canonicalTools = new Map([
      ...PRESETS_BINARY_TOOLS.map((tool) => [tool.name, tool.tool] as const),
      ...CODE_CLI_TOOL_PRESETS.map((tool) => [tool.executable, tool.miseTool] as const)
    ])
    const canonicalTool = canonicalTools.get(request.intent.name)
    if (canonicalTool && canonicalTool !== request.intent.tool) {
      throw new Error(`Tool ${request.intent.name} must use its canonical specification`)
    }

    const runtimeTool = request.intent.tool.replace(/^core:/, '').split('@')[0]
    const usesRuntimeBackend = isRuntimeDependency(request.intent.tool)
    const hasRuntimeName = request.intent.name === 'node' || request.intent.name === 'python'
    if ((usesRuntimeBackend && request.intent.name !== runtimeTool) || (hasRuntimeName && !usesRuntimeBackend)) {
      throw new Error(`Runtime ${request.intent.name} must use its canonical runtime specification`)
    }
  }

  /**
   * Inventory ownership follows the durable Preference manifest. Live mise data
   * may supplement it only with node/python runtime dependencies.
   */
  async listTools(): Promise<BinaryToolInventoryEntry[]> {
    const manifest = this.getManifest()
    const tools: BinaryToolInventoryEntry[] = manifest.map((intent) => ({
      name: intent.name,
      tool: intent.tool,
      version: '',
      ...(intent.requestedVersion ? { requestedVersion: intent.requestedVersion } : {}),
      managed: true
    }))
    if (!this.miseBin) return tools

    try {
      const { stdout } = await this.runMise(['ls', '--json'])
      const installed = JSON.parse(stdout) as Record<string, Array<{ version?: string; active?: boolean }>>
      const normalize = (spec: string) => (spec.startsWith('core:') ? spec.slice('core:'.length) : spec)
      const managedVersions = this.getInstalledVersionsFromOutput(manifest, installed)
      for (const tool of tools) tool.version = managedVersions[tool.name] ?? ''

      const recorded = new Set(tools.map((tool) => normalize(tool.tool)))
      for (const [spec, versions] of Object.entries(installed)) {
        if (recorded.has(normalize(spec))) continue
        const name = normalize(spec).split('@')[0]
        if (!TOOL_NAME_RE.test(name) || !isRuntimeDependency(spec)) continue
        const version = versions.find((v) => v.active)?.version ?? versions.at(-1)?.version ?? ''
        tools.push({ name, tool: spec, version, managed: false })
      }
    } catch (err) {
      logger.warn('Failed to merge mise ls into inventory', {
        error: err instanceof Error ? err.message : String(err)
      })
    }
    return tools
  }

  /** Session-only operation state; every transition triggers a renderer refresh. */
  private setOperation(name: string, operation: BinaryOperation | null) {
    const cacheService = application.get('CacheService')
    const operations = { ...cacheService.getShared('feature.binary.install_states') }
    if (operation) {
      operations[name] = operation
    } else {
      delete operations[name]
    }
    cacheService.setShared('feature.binary.install_states', operations)
    application.get('IpcApiService').broadcast('binary.availability_changed', undefined)
  }

  installTool(request: BinaryInstallRequest): Promise<{ version: string }> {
    try {
      this.validateInstallRequest(request)
    } catch (err) {
      return Promise.reject(err)
    }
    const { intent } = request
    const active = this.activeMutations.get(intent.name)
    if (active) {
      if (
        active.action === 'install' &&
        active.request.intent.tool === intent.tool &&
        active.request.intent.requestedVersion === intent.requestedVersion &&
        active.request.targetVersion === request.targetVersion
      ) {
        return active.promise
      }
      return Promise.reject(
        new Error(
          active.action === 'remove'
            ? `Tool ${intent.name} is already removing`
            : `Tool ${intent.name} is already installing with a different specification`
        )
      )
    }
    if (!this.miseBin) {
      const error = new Error('Binary backend not available')
      this.setOperation(intent.name, { status: 'failed', action: 'install', error: error.message, intent })
      return Promise.reject(error)
    }

    // Publish before queuing on the global mutex so every renderer can render
    // the operation while another tool holds mise's process-wide lock.
    this.setOperation(intent.name, { status: 'installing' })
    const promise = this.installToolImpl(request)
    this.activeMutations.set(intent.name, { action: 'install', request, promise })
    void promise
      .finally(() => {
        if (this.activeMutations.get(intent.name)?.promise === promise) this.activeMutations.delete(intent.name)
      })
      .catch(() => undefined)
    return promise
  }

  private async installToolImpl(request: BinaryInstallRequest): Promise<{ version: string }> {
    const { intent, targetVersion } = request
    try {
      const result = await this.mutationMutex.runExclusive(async () => {
        const manifest = this.getManifest()
        const existing = manifest.find((entry) => entry.name === intent.name)
        if (existing && (existing.tool !== intent.tool || existing.requestedVersion !== intent.requestedVersion)) {
          throw new Error(`Tool ${intent.name} is already owned with a different specification`)
        }

        let persistedIntent = intent
        let version: string
        const isRuntime = isRuntimeDependency(intent.tool)
        const runtimeReady = isRuntime && (await this.isManagedBinaryReady(intent.name))
        const currentRuntimeVersion = runtimeReady ? await this.getInstalledVersion(intent.tool) : undefined
        const desiredRuntimeVersion = targetVersion ?? intent.requestedVersion
        const normalizedDesiredRuntimeVersion = desiredRuntimeVersion ? semverValid(desiredRuntimeVersion) : null
        const canClaimRuntime =
          currentRuntimeVersion !== undefined &&
          (!desiredRuntimeVersion ||
            (normalizedDesiredRuntimeVersion !== null &&
              semverValid(currentRuntimeVersion) === normalizedDesiredRuntimeVersion))

        if (canClaimRuntime) {
          version = currentRuntimeVersion
          persistedIntent = intent.requestedVersion ? intent : { ...intent, requestedVersion: version }
        } else {
          version = await this.installWithMise(intent, targetVersion, manifest)
          if (!(await this.isManagedBinaryReady(intent.name))) {
            throw new Error(`Tool installed but not runnable: ${intent.name}`)
          }
          if (isRuntime && !intent.requestedVersion) {
            if (!version) throw new Error(`Runtime installed but its version could not be determined: ${intent.name}`)
            persistedIntent = { ...intent, requestedVersion: version }
          }
        }

        await this.upsertManifest(persistedIntent)
        return { version }
      })
      this.setOperation(intent.name, null)
      return result
    } catch (err) {
      this.setOperation(intent.name, {
        status: 'failed',
        action: 'install',
        error: err instanceof Error ? err.message : String(err),
        intent
      })
      throw err
    }
  }

  private async loadRegistry(): Promise<Array<{ name: string; tool: string }>> {
    if (this.registryCache && Date.now() - this.registryCacheTime < REGISTRY_CACHE_TTL_MS) {
      return this.registryCache
    }

    const { stdout } = await this.runMise(['registry', '--json'])
    const parsed = JSON.parse(stdout) as Array<{ short?: string; backends?: string[] }>
    const entries = parsed.flatMap((e) =>
      e.short && e.backends?.length ? [{ name: e.short, tool: e.backends[0] }] : []
    )

    this.registryCache = entries
    this.registryCacheTime = Date.now()
    return entries
  }

  async searchRegistry(query: string): Promise<Array<{ name: string; tool: string }>> {
    if (!this.miseBin || !query.trim()) {
      return []
    }

    let registry: Array<{ name: string; tool: string }>
    try {
      registry = await this.loadRegistry()
    } catch (err) {
      // A mise too old for `registry --json` (rejects the flag) or a malformed
      // dump rejects here. Log and rethrow so the IPC route rejects and the
      // renderer's search-error UI surfaces it — swallowing to [] would render a
      // silently empty dropdown that reads as "no such tool in the registry".
      logger.warn('Failed to load mise registry', err as Error)
      throw err
    }
    const q = query.toLowerCase()
    return registry.filter((entry) => entry.name.toLowerCase().includes(q)).slice(0, 50)
  }

  /**
   * Latest available registry version for each mise-managed tool (name → version).
   * On demand only — never during boot — because `mise latest` for
   * github: backends hits the rate-limited GitHub releases API. Runs with a
   * small worker pool; tools whose lookup fails are omitted.
   *
   * Stored in shared CacheService state for the current app session. A non-force
   * read is cache-only; only force=true runs `mise latest`.
   */
  async getLatestVersions(force = false): Promise<Record<string, string>> {
    const cacheService = application.get('CacheService')
    const cached = cacheService.getShared('feature.binary.latest_versions')
    if (!force) {
      return cached || {}
    }
    if (this.latestVersionsPromise) {
      return this.latestVersionsPromise
    }
    this.latestVersionsPromise = this.fetchLatestVersions().finally(() => {
      this.latestVersionsPromise = null
    })
    return this.latestVersionsPromise
  }

  private async fetchLatestVersions(): Promise<Record<string, string>> {
    const manifest = this.getManifest()
    const result: Record<string, string> = {}
    if (!this.miseBin) return result

    const fingerprint = this.manifestFingerprint(manifest)
    let cursor = 0
    const workers = Array.from({ length: Math.min(LATEST_VERSIONS_CONCURRENCY, manifest.length) }, async () => {
      while (cursor < manifest.length) {
        const { name, tool } = manifest[cursor++]
        try {
          const { stdout } = await this.runMise(['latest', tool])
          const version = stdout.trim().split(/\r?\n/)[0]?.trim()
          if (version) result[name] = version
        } catch (err) {
          logger.warn('Failed to query latest version', {
            name,
            tool,
            error: err instanceof Error ? err.message : String(err)
          })
        }
      }
    })
    await Promise.all(workers)

    if (manifest.length > 0 && Object.keys(result).length === 0) {
      throw new Error('Failed to query latest versions for all managed tools')
    }

    return this.mutationMutex.runExclusive(async () => {
      if (this.manifestFingerprint() !== fingerprint) return {}
      application.get('CacheService').setShared('feature.binary.latest_versions', result)
      return result
    })
  }

  removeTool(toolName: string): Promise<void> {
    const active = this.activeMutations.get(toolName)
    if (active) {
      if (active.action === 'remove') return active.promise
      return Promise.reject(new Error(`Tool ${toolName} is already installing`))
    }

    // As with installs, expose removal before waiting for a mutation of another
    // tool. The active-mutation guard makes this state exclusively ours.
    this.setOperation(toolName, { status: 'removing' })
    const promise = this.removeToolImpl(toolName)
    this.activeMutations.set(toolName, { action: 'remove', promise })
    void promise
      .finally(() => {
        if (this.activeMutations.get(toolName)?.promise === promise) this.activeMutations.delete(toolName)
      })
      .catch(() => undefined)
    return promise
  }

  private async removeToolImpl(toolName: string): Promise<void> {
    return this.mutationMutex.runExclusive(async () => {
      const intent = this.getManifest().find((entry) => entry.name === toolName)
      if (!intent) {
        this.setOperation(toolName, null)
        return
      }
      try {
        if (!this.miseBin) throw new Error('Binary backend not available')

        const wasAbsent = await this.isMiseToolAbsent(intent.tool)
        if (!wasAbsent) {
          await this.runMise(['unuse', '-g', intent.tool])
          await this.runMise(['uninstall', '--all', intent.tool])
        }
        // Run even for an already-absent tool: a prior uninstall may have
        // succeeded before reshim failed, leaving a stale shim to clean up.
        await this.runMise(['reshim'])
        if (!wasAbsent && !(await this.isMiseToolAbsent(intent.tool))) {
          throw new Error(`Tool is still installed after removal: ${toolName}`)
        }
        await this.removeManifest(toolName)
        this.setOperation(toolName, null)
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        logger.warn('Failed to remove mise tool', { name: toolName, error: error.message })
        this.setOperation(toolName, { status: 'failed', action: 'remove', error: error.message })
        throw error
      }
    })
  }
}
