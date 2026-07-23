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
import { getRawShellEnv, refreshShellEnv } from '@main/utils/shellEnv'
import type { CustomToolDefinition } from '@shared/data/preference/preferenceTypes'
import {
  BINARY_INSTALL_PREFERENCE_KEYS,
  isRuntimeDependency,
  PRESETS_BINARY_TOOLS,
  type RuntimeInterpreter,
  TOOL_KEY_RE,
  validateBinaryToolDefinition
} from '@shared/data/presets/binaryTools'
import { CODE_CLI_TOOL_PRESETS } from '@shared/data/presets/codeCliTools'
import type {
  BinaryApplication,
  BinaryAvailability,
  BinaryInstallByNameRequest,
  BinaryOperation,
  BinaryOperations,
  BinaryRemoveRequest,
  BinaryRemoveResult,
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

// Backend → default runtime spec. The runtime name must be a registered
// RuntimeInterpreter, so a new backend can't silently bypass isRuntimeDependency.
const RUNTIME_DEPS: Record<string, `${RuntimeInterpreter}@${string}`> = { npm: 'node@22', pipx: 'python@3.12' }

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

// Main-owned session state. Renderer windows receive operations only through
// snapshots, so this belongs to CacheService's internal tier rather than its
// cross-window shared mirror.
const BINARY_OPERATIONS_CACHE_KEY = 'feature.binary.install_states'

function parseInstallUrl(value: string, setting: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  let url: URL
  try {
    url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error()
  } catch {
    throw new Error(`${setting} must be a valid HTTP(S) URL`)
  }
  // Embedded credentials would flow into mise's environment and could be echoed
  // back through stderr into renderer-visible operation errors, logs, and the
  // copyable failure dialog. These settings address public registries/mirrors,
  // so reject userinfo outright instead of letting secrets transit error text.
  if (url.username || url.password) {
    throw new Error(`${setting} must not contain embedded credentials`)
  }
  return url.toString().replace(/\/$/, '')
}

// Ambient PIP_INDEX_URL comes from the user's login shell, not Cherry's install
// settings. A non-HTTP value there (e.g. a `file://` index) must not abort the
// whole isolated-env build and brick every mise operation with a misleading
// "pip index" error — it is left to pass through unchanged, exactly as an ambient
// NPM_CONFIG_REGISTRY is. Only Cherry's own explicit setting is strictly
// validated (parseInstallUrl throws to surface the user's own misconfiguration).
function parseAmbientUrl(value: string | undefined, setting: string): string | undefined {
  if (!value) return undefined
  try {
    return parseInstallUrl(value, setting)
  } catch {
    logger.warn(`Ignoring invalid ambient ${setting}; passing it through to mise unchanged`)
    return undefined
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

/** A code-owned fixed tool definition. Structural — never a persisted custom entry. */
type FixedToolDefinition = { name: string; tool: string }

// Code-owned catalog of the fixed tools Cherry ships: every Dependencies preset
// executable and every Code CLI executable mapped to its canonical mise recipe.
// Derived from the two preset sources so their names and recipes stay the single
// source of truth. Fixed definitions carry no requestedVersion — a version pin is
// a per-install / runtime fact, never part of the canonical identity.
const normalizeToolIdentity = (tool: string): string => (tool.startsWith('core:') ? tool.slice('core:'.length) : tool)

const FIXED_CATALOG: ReadonlyMap<string, FixedToolDefinition> = new Map<string, FixedToolDefinition>([
  ...PRESETS_BINARY_TOOLS.map((preset): [string, FixedToolDefinition] => [
    preset.name,
    { name: preset.name, tool: preset.tool }
  ]),
  ...CODE_CLI_TOOL_PRESETS.map((preset): [string, FixedToolDefinition] => [
    preset.executable,
    { name: preset.executable, tool: preset.miseTool }
  ])
])

// Re-exported for main-process callers and tests.
export { validateBinaryToolDefinition }

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
  // Serializes custom-registry read-modify-write with filesystem mutations so
  // concurrent requests cannot lose definitions or interleave mise global changes.
  private readonly mutationMutex = new Mutex()
  // A global mutex serializes mise and custom-registry changes. This separate
  // guard prevents a same-tool request queued behind it from replacing the
  // operation state that belongs to the request already running or waiting. The
  // live routes are `installByName` (dedupe by one-shot target), `addCustom`
  // (dedupe by exact definition), and `remove` (dedupe by definition-only flag).
  private readonly activeMutations = new Map<
    string,
    | { action: 'installByName'; targetVersion?: string; promise: Promise<void> }
    | { action: 'addCustom'; definition: CustomToolDefinition; promise: Promise<void> }
    | { action: 'remove'; definitionOnly: boolean; promise: Promise<BinaryRemoveResult> }
  >()
  private latestVersionsPromise: Promise<Record<string, string>> | null = null
  // Monotonic counter bumped on every mutation that can change backend state or
  // durable definitions (add / install / update / remove / definition-only). A
  // forced latest-versions batch captures it before its slow `mise latest`
  // queries and discards its result if the count moved — replacing the former
  // definition-fingerprint race guard, which only saw definition changes and was
  // blind to backend-only installs and removals.
  private mutationRevision = 0

  // Set the first time onAllReady fires (once per instance). Distinguishes an
  // initial-bootstrap onInit (before onAllReady) from a post-restart onInit
  // (after onAllReady already fired) — see registerPreferenceInvalidation.
  private hasReachedAllReady = false
  private isShuttingDown = false
  private normalizationPromise: Promise<void> | null = null

  protected async onInit() {
    this.isShuttingDown = false
    this.normalizationPromise = null
    // Install-env invalidation subscription: this Background service depends on
    // PreferenceService, a BeforeReady service. A Background onInit is fire-and-forget
    // and races BeforeReady/WhenReady (Application.bootstrap sets isBootstrapped only
    // after WhenReady but before awaiting Background), so PreferenceService is NOT
    // guaranteed initialized here on initial bootstrap. So the FIRST registration
    // happens in onAllReady (system-wide readiness, the sanctioned hook for a
    // Background service to reach another phase). onAllReady fires at most once per
    // instance and does not re-run on restart, while registerDisposable's subscription
    // is torn down on stop — so onInit re-registers on restart, gated on
    // hasReachedAllReady so it only touches PreferenceService once the app has fully
    // bootstrapped (always true by the time any restart runs).
    if (this.hasReachedAllReady) this.registerPreferenceInvalidation()
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

  protected override onAllReady(): void {
    // System-wide readiness: every phase (incl. BeforeReady's PreferenceService) is
    // initialized, so this is the safe first registration for a Background service,
    // and the first point at which reading/writing Preference is safe.
    this.hasReachedAllReady = true
    this.registerPreferenceInvalidation()

    // onAllReady is fire-and-forget. Own this deferred hygiene pass explicitly so
    // service stop can cancel it before start or join it once in flight.
    const handle = setTimeout(() => {
      if (this.isShuttingDown) return
      this.normalizationPromise = this.normalizeCustomDefinitions().catch((err) => {
        logger.warn('Failed to normalize binary custom registry', { error: this.errorMessage(err) })
      })
    }, 0)
    this.registerDisposable(() => clearTimeout(handle))
  }

  protected override async onStop(): Promise<void> {
    this.isShuttingDown = true
    if (this.normalizationPromise) await this.normalizationPromise
    this.normalizationPromise = null
  }

  /**
   * Subscribe to the install-affecting preferences (and proxy settings) so the
   * memoized isolated install env is rebuilt on the next mise invocation after a
   * change. Registered via registerDisposable so it is cleaned up on stop; the
   * onInit/onAllReady split above re-creates it across a service restart.
   */
  private registerPreferenceInvalidation() {
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
    // aliases such as uvx resolve through the same bundled boundary as uv.
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
   * Return one weakly-consistent, main-computed view of custom definitions, live
   * availability, and session operations. This deliberately does not take the
   * mutation mutex: a slow install must not hide its already-published operation.
   */
  public async getToolSnapshots(requestedNames: string[]): Promise<Record<string, BinaryToolSnapshot>> {
    const definitions = this.getCustomDefinitions()
    const customDefinitions = definitions.filter((definition) => !FIXED_CATALOG.has(definition.name))
    const operations = application.get('CacheService').get<BinaryOperations>(BINARY_OPERATIONS_CACHE_KEY) ?? {}
    const definitionsByName = new Map(customDefinitions.map((definition) => [definition.name, definition]))
    const candidates = new Map<string, string>()
    const addCandidate = (name: string, tool: string) => {
      if (!candidates.has(name)) candidates.set(name, tool)
    }

    // Candidate recipes come from the code-owned fixed catalog and the custom
    // registry only. Fixed definitions are authoritative: a stale fixed-name entry
    // written by an older build is neither exposed as a custom definition nor
    // allowed to replace the recipe used to derive application state. Operations
    // never contribute a recipe — an operation-only name has no candidate and so
    // omits its application fact.
    for (const [name, definition] of FIXED_CATALOG) addCandidate(name, definition.tool)
    for (const definition of customDefinitions) addCandidate(definition.name, definition.tool)
    for (const name of requestedNames) addCandidate(name, name)

    const installed: Record<string, Array<{ version?: string; active?: boolean; install_path?: string }>> = {}
    // Backend state is derived once and drives the independent application fact:
    // a missing backend is `backend_unavailable`, a failed/malformed query is
    // `query_failed`. Neither may ever collapse a tool to `absent`.
    let queryFailed = false
    if (this.miseBin) {
      try {
        const { stdout } = await this.runMise(['ls', '--json'])
        const parsed: unknown = JSON.parse(stdout)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('mise ls --json returned a non-object shape')
        }
        for (const [spec, entries] of Object.entries(parsed)) {
          if (!Array.isArray(entries)) throw new Error(`mise ls --json returned invalid entries for ${spec}`)
          for (const entry of entries) {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
              throw new Error(`mise ls --json returned an invalid install for ${spec}`)
            }
          }
        }
        Object.assign(installed, parsed as typeof installed)
      } catch (err) {
        queryFailed = true
        logger.warn('Failed to query installed versions via mise ls', {
          error: err instanceof Error ? err.message : String(err)
        })
      }
    }

    for (const [spec] of Object.entries(installed)) {
      const name = normalizeToolIdentity(spec).split('@')[0]
      if (isRuntimeDependency(spec)) addCandidate(name, spec)
    }

    const installedFor = (tool: string) => {
      const normalized = normalizeToolIdentity(tool)
      const runtimeName = isRuntimeDependency(tool) ? normalized.split('@')[0] : undefined
      return (
        installed[normalized] ??
        Object.entries(installed).find(([spec]) => normalizeToolIdentity(spec) === normalized)?.[1] ??
        (runtimeName
          ? Object.entries(installed).find(([spec]) => normalizeToolIdentity(spec).split('@')[0] === runtimeName)?.[1]
          : undefined)
      )
    }
    const names = new Set([...requestedNames, ...definitionsByName.keys(), ...Object.keys(operations)])
    for (const [spec] of Object.entries(installed)) {
      const name = normalizeToolIdentity(spec).split('@')[0]
      if (isRuntimeDependency(spec)) names.add(name)
    }
    const bundled = this.probeBundled()
    const shimsDir = getBinarySearchDirs()[0]

    // The exact-application fact is independent of runnable availability. When the
    // backend cannot answer, every name is `unknown` with the reason — never a
    // misleading `absent` inferred from an empty query.
    const backendUnknown: BinaryApplication | null = !this.miseBin
      ? { status: 'unknown', reason: 'backend_unavailable' }
      : queryFailed
        ? { status: 'unknown', reason: 'query_failed' }
        : null

    type DerivedTool = { application?: BinaryApplication; mise?: { path: string; version?: string } }

    const hasExecutableCandidateShim = async (shimPath: string): Promise<boolean> => {
      if (!fs.existsSync(shimPath)) return false
      try {
        await fsp.access(shimPath, isWin ? fs.constants.F_OK : fs.constants.X_OK)
        return true
      } catch {
        return false
      }
    }

    // The batched listing proves backend application identity; `mise which`
    // additionally proves every exposed shim still resolves a runnable target.
    const derive = async (name: string): Promise<DerivedTool> => {
      const tool = candidates.get(name)
      if (!tool) return {}

      const shimPath = path.join(shimsDir, getBinaryName(name))
      if (backendUnknown) {
        if (
          this.miseBin &&
          (await hasExecutableCandidateShim(shimPath)) &&
          (await this.resolveManagedBinaryPath(name))
        ) {
          return { application: backendUnknown, mise: { path: shimPath } }
        }
        return { application: backendUnknown }
      }

      const entries = installedFor(tool)
      if (entries?.length) {
        const activeEntry = entries.find((entry) => entry.active)
        const version = activeEntry?.version ?? entries.at(-1)?.version
        if (!activeEntry) {
          // Installed artifacts are not an applied recipe. A leftover shim counts
          // as runnable only when mise itself can still resolve its target.
          const resolved = (await hasExecutableCandidateShim(shimPath)) && (await this.resolveManagedBinaryPath(name))
          return {
            application: { status: 'broken', ...(version ? { version } : {}) },
            ...(resolved ? { mise: { path: shimPath, ...(version ? { version } : {}) } } : {})
          }
        }
        try {
          await fsp.access(shimPath, isWin ? fs.constants.F_OK : fs.constants.X_OK)
        } catch {
          return { application: { status: 'broken', ...(version ? { version } : {}) } }
        }
        const resolved = await this.resolveManagedBinaryPath(name)
        if (!resolved) {
          return { application: { status: 'broken', ...(version ? { version } : {}) } }
        }
        // The active entry proves the exact recipe is installed; the shim must also
        // resolve to THIS entry's install, not a same-named binary from another
        // backend entry in the isolated env. Otherwise `applied` would grant
        // Update/Uninstall authority over a foreign provider. When mise omits
        // install_path, fall back to the runnable-only check above.
        if (typeof activeEntry.install_path === 'string' && !isPathWithin(activeEntry.install_path, resolved)) {
          return { application: { status: 'broken', ...(version ? { version } : {}) } }
        }
        return {
          application: { status: 'applied', ...(version ? { version } : {}) },
          mise: { path: shimPath, ...(version ? { version } : {}) }
        }
      }

      if (!(await hasExecutableCandidateShim(shimPath))) return { application: { status: 'absent' } }
      if (await this.resolveManagedBinaryPath(name)) {
        return { application: { status: 'conflict' }, mise: { path: shimPath } }
      }

      logger.warn('Ignoring stale mise shim with no resolvable install', { name, shimPath })
      return { application: { status: 'absent' } }
    }

    const derived = new Map(await Promise.all([...names].map(async (name) => [name, await derive(name)] as const)))
    const system = await this.probeSystem([...names].filter((name) => !derived.get(name)?.mise && !(name in bundled)))
    const snapshots: Record<string, BinaryToolSnapshot> = {}
    for (const name of names) {
      const derivedTool = derived.get(name)!
      const mise = derivedTool.mise
      const availability: BinaryAvailability = mise
        ? {
            source: 'mise',
            path: mise.path,
            ...(mise.version ? { version: mise.version } : {})
          }
        : name in bundled
          ? {
              source: 'bundled',
              path: application.getPath('cherry.bin', getBinaryName(name)),
              ...(bundled[name] ? { version: bundled[name] } : {})
            }
          : system[name]
            ? { source: 'system', path: system[name] }
            : { source: 'none' }
      const operation = operations[name]
      // A failed install is stale only when the exact recipe is proven absent
      // and an out-of-band executable now satisfies the tool. Unknown/broken
      // application still needs the failure row to explain why Retry made no
      // change, even if system/bundled availability keeps execution possible.
      const staleFailedInstall =
        operation?.status === 'failed' &&
        operation.action === 'install' &&
        (!derivedTool.application || derivedTool.application.status === 'absent') &&
        (availability.source === 'system' || availability.source === 'bundled')
      snapshots[name] = {
        name,
        ...(definitionsByName.has(name) ? { definition: definitionsByName.get(name)! } : {}),
        availability,
        ...(derivedTool.application ? { application: derivedTool.application } : {}),
        ...(operation && !staleFailedInstall ? { operation } : {})
      }
    }
    return snapshots
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
    const pipIndexUrl =
      parseInstallUrl(installSettings.pipIndexUrl, 'pip index') ?? parseAmbientUrl(env['PIP_INDEX_URL'], 'pip index')
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
    definition: CustomToolDefinition,
    targetVersion: string | undefined,
    definitions: CustomToolDefinition[]
  ): Promise<string> {
    const requested = targetVersion ?? definition.requestedVersion ?? 'latest'
    const backend = definition.tool.split(':')[0]
    const defaultRuntime = RUNTIME_DEPS[backend]
    const runtimeName = defaultRuntime?.split('@')[0]
    const pinnedRuntime = runtimeName
      ? definitions.find((entry) => {
          const runtimeTool = entry.tool.startsWith('core:') ? entry.tool.slice('core:'.length) : entry.tool
          return isRuntimeDependency(entry.tool) && runtimeTool.split('@')[0] === runtimeName
        })
      : undefined
    // The narrow template type is RUNTIME_DEPS's guarantee; the local is just a
    // `<tool>@<version>` command fragment, which the pinned-runtime branch widens.
    let runtime: string | undefined = defaultRuntime
    if (pinnedRuntime) {
      const runtimeTool = pinnedRuntime.tool.replace(/@[^@]+$/, '')
      const runtimeVersion = pinnedRuntime.requestedVersion ?? (await this.getInstalledVersion(runtimeTool))
      runtime = `${runtimeTool}@${runtimeVersion}`
    }
    const toolSpec = `${definition.tool}@${requested}`

    await this.runMise(['use', '-g', ...(runtime ? [runtime] : []), toolSpec], { timeoutMs: MISE_INSTALL_TIMEOUT_MS })
    await this.runMise(['reshim'])
    return this.getInstalledVersion(definition.tool, requested)
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

  private async isMiseToolAbsent(tool: string): Promise<boolean> {
    const { stdout } = await this.runMise(['ls', '--json', tool])
    const entries = Object.values(JSON.parse(stdout) as Record<string, Array<{ version?: string }>>).flat()
    return entries.length === 0
  }

  private getCustomDefinitions(): CustomToolDefinition[] {
    return application.get('PreferenceService').get('feature.binary.tools')
  }

  private async upsertCustomDefinition(definition: CustomToolDefinition): Promise<void> {
    const definitions = this.getCustomDefinitions()
    await application
      .get('PreferenceService')
      .set('feature.binary.tools', [...definitions.filter((entry) => entry.name !== definition.name), definition])
    this.invalidateDerivedViews()
  }

  private async removeCustomDefinition(toolName: string): Promise<void> {
    const definitions = this.getCustomDefinitions()
    await application.get('PreferenceService').set(
      'feature.binary.tools',
      definitions.filter((entry) => entry.name !== toolName)
    )
    this.invalidateDerivedViews()
  }

  /**
   * Record a mutation that can change backend state or durable definitions.
   * Bumps the revision a forced latest-versions batch guards on and clears the
   * now-stale latest-versions cache. Backend-only mutations (a name-only install
   * over a fixed tool, a fixed remove) call this directly; definition changes
   * reach it through {@link invalidateDerivedViews}.
   */
  private bumpMutationRevision() {
    this.mutationRevision++
    try {
      application.get('CacheService').deleteShared('feature.binary.latest_versions')
    } catch (err) {
      // Cache is derived session state. A failed invalidation must not turn an
      // already-committed backend/Preference mutation into a false failure.
      logger.warn('Failed to clear binary latest-version cache', { error: this.errorMessage(err) })
    }
  }

  private broadcastAvailabilityChanged() {
    try {
      application.get('IpcApiService').broadcast('binary.availability_changed', undefined)
    } catch (err) {
      // The next snapshot is authoritative; notification failure is recoverable.
      logger.warn('Failed to broadcast binary availability change', { error: this.errorMessage(err) })
    }
  }

  private invalidateDerivedViews() {
    this.bumpMutationRevision()
    this.broadcastAvailabilityChanged()
  }

  /**
   * Validate a tool definition's identity and canonical/runtime spec. Beyond the
   * shared grammar check it enforces that a fixed name keeps its canonical recipe
   * and that a runtime name/backend pair stays consistent.
   */
  private validateDefinitionSpec(definition: CustomToolDefinition) {
    validateBinaryToolDefinition(definition)
    const fixed = this.resolveFixedDefinition(definition.name)
    if (fixed && fixed.tool !== definition.tool) {
      throw new Error(`Tool ${definition.name} must use its canonical specification`)
    }

    const runtimeTool = definition.tool.replace(/^core:/, '').split('@')[0]
    const usesRuntimeBackend = isRuntimeDependency(definition.tool)
    const hasRuntimeName = definition.name === 'node' || definition.name === 'python'
    if ((usesRuntimeBackend && definition.name !== runtimeTool) || (hasRuntimeName && !usesRuntimeBackend)) {
      throw new Error(`Runtime ${definition.name} must use its canonical runtime specification`)
    }
  }

  /** Main-owned session operation state; every transition triggers a renderer refresh. */
  private setOperation(name: string, operation: BinaryOperation | null) {
    const cacheService = application.get('CacheService')
    const operations = { ...cacheService.get<BinaryOperations>(BINARY_OPERATIONS_CACHE_KEY) }
    if (operation) {
      operations[name] = operation
    } else {
      delete operations[name]
    }
    cacheService.set(BINARY_OPERATIONS_CACHE_KEY, operations)
    this.broadcastAvailabilityChanged()
  }

  /** Resolve the code-owned fixed definition for a name, if the app ships one. */
  private resolveFixedDefinition(name: string): FixedToolDefinition | undefined {
    return FIXED_CATALOG.get(name)
  }

  /**
   * Resolve the recipe a name-only install applies. The code-owned fixed catalog
   * is authoritative — it wins over any stale same-name Preference entry left by a
   * prior version. A custom name resolves only from the persisted custom registry.
   */
  private resolveDefinition(name: string): CustomToolDefinition | undefined {
    return this.resolveFixedDefinition(name) ?? this.getCustomDefinitions().find((entry) => entry.name === name)
  }

  /**
   * Drop runtime entries whose exact recipe is not applied locally before a
   * backend apply. A persist-first custom definition (or a stale pin) is a mere
   * definition, not proof the runtime is installed — so a package backend must
   * fall back to its default RUNTIME_DEPS runtime rather than adopt an unapplied
   * one. Uses the exact live application fact, never desired state or mere
   * availability.
   */
  private async appliedRuntimeDefinitions(definitions: CustomToolDefinition[]): Promise<CustomToolDefinition[]> {
    const runtimeNames = definitions.filter((entry) => isRuntimeDependency(entry.tool)).map((entry) => entry.name)
    if (runtimeNames.length === 0) return definitions

    const snapshots = await this.getToolSnapshots(runtimeNames)
    return definitions.flatMap((entry) => {
      if (!isRuntimeDependency(entry.tool)) return [entry]
      const application = snapshots[entry.name]?.application
      // Package installs may inherit only a proven exact runtime application and
      // must use its live active version, never the portable definition default.
      return application?.status === 'applied' && application.version
        ? [{ ...entry, requestedVersion: application.version }]
        : []
    })
  }

  /**
   * Run the mise backend for a definition. Adopts a ready runtime at its live
   * version when it satisfies the request (runtime live-version adoption),
   * otherwise installs via mise honoring the one-shot target and verifies
   * runnability. Pure backend work: it neither writes Preference nor publishes
   * operation state — persisted definitions are never rewritten with a resolved
   * version, so there is no pin to hand back.
   */
  private async applyDefinition(
    definition: CustomToolDefinition,
    targetVersion: string | undefined,
    definitions: CustomToolDefinition[]
  ): Promise<void> {
    const isRuntime = isRuntimeDependency(definition.tool)
    const runtimeReady = isRuntime && (await this.isManagedBinaryReady(definition.name))
    const currentRuntimeVersion = runtimeReady ? await this.getInstalledVersion(definition.tool) : undefined
    const desiredRuntimeVersion = targetVersion ?? definition.requestedVersion
    const normalizedDesiredRuntimeVersion = desiredRuntimeVersion ? semverValid(desiredRuntimeVersion) : null
    const canAdoptRuntime =
      currentRuntimeVersion !== undefined &&
      (!desiredRuntimeVersion ||
        (normalizedDesiredRuntimeVersion !== null &&
          semverValid(currentRuntimeVersion) === normalizedDesiredRuntimeVersion))

    if (canAdoptRuntime) return

    // installWithMise resolves the installed version as verification that mise
    // actually applied the request; the value itself is not consumed.
    await this.installWithMise(definition, targetVersion, definitions)
    if (!(await this.isManagedBinaryReady(definition.name))) {
      throw new Error(`Tool installed but not runnable: ${definition.name}`)
    }
  }

  /**
   * Name-only install. Main resolves the fixed/custom recipe from its code-owned
   * catalog or the current custom registry and applies it against the live application
   * fact — it never writes Preference (a fixed recipe is code-owned; a custom
   * recipe was already persisted by Custom Add). An unknown name, a foreign
   * conflict, or an unreadable backend reject without mutating; an already-applied
   * tool is a no-op (or a one-shot version update when a target is given); an
   * externally satisfied tool (bundled/system) is a logged no-op so a race
   * converges. A backend failure records a failed operation and rejects.
   */
  installByName(request: BinaryInstallByNameRequest): Promise<void> {
    const { name, targetVersion } = request
    if (targetVersion && !TOOL_KEY_RE.test(targetVersion)) {
      return Promise.reject(new Error(`Invalid tool version: ${targetVersion}`))
    }
    if (!this.resolveDefinition(name)) {
      return Promise.reject(new Error(`Unknown tool: ${name}`))
    }
    const active = this.activeMutations.get(name)
    if (active) {
      // Dedupe compares name (map key), action, and one-shot target.
      if (active.action === 'installByName' && active.targetVersion === targetVersion) return active.promise
      return Promise.reject(
        new Error(
          active.action === 'remove' ? `Tool ${name} is already removing` : `Tool ${name} is already installing`
        )
      )
    }
    if (!this.miseBin) {
      const error = new Error('Binary backend not available')
      this.setOperation(name, {
        status: 'failed',
        action: 'install',
        error: error.message,
        ...(targetVersion ? { targetVersion } : {})
      })
      return Promise.reject(error)
    }

    // Publish before queuing on the global mutex so every renderer can render the
    // operation while another tool holds mise's process-wide lock.
    this.setOperation(name, { status: 'installing' })
    const promise = this.installByNameImpl(name, targetVersion)
    this.activeMutations.set(name, { action: 'installByName', targetVersion, promise })
    void promise
      .finally(() => {
        if (this.activeMutations.get(name)?.promise === promise) this.activeMutations.delete(name)
      })
      .catch(() => undefined)
    return promise
  }

  private async installByNameImpl(name: string, targetVersion: string | undefined): Promise<void> {
    const outcome = await this.mutationMutex.runExclusive(
      async (): Promise<{ kind: 'done' } | { kind: 'reject' | 'failed'; error: string }> => {
        const definition = this.resolveDefinition(name)
        if (!definition) return { kind: 'reject', error: `Unknown tool: ${name}` }

        // The system probe reads the cached login-shell env, which can predate a
        // CLI the user installed mid-session; deciding from that stale PATH would
        // lay down a managed shadow copy over a now-present system binary.
        // Re-capture before deriving the facts this decision runs on (the fetch
        // falls back to process.env on failure and never rejects).
        await refreshShellEnv()
        const snapshot = (await this.getToolSnapshots([name]))[name]
        const status = snapshot.application?.status
        const source = snapshot.availability.source

        // conflict/unknown: the exact recipe is not proven absent, and installing
        // over a foreign shim or an unreadable backend could shadow an existing
        // tool — reject without mutating.
        if (status === 'conflict')
          return { kind: 'failed', error: `Tool ${name} resolves to a conflicting installation` }
        if (status === 'unknown') {
          const reason = snapshot.application?.status === 'unknown' ? snapshot.application.reason : 'query_failed'
          return { kind: 'failed', error: `Cannot determine ${name} state: ${reason}` }
        }
        // applied: nothing to do unless a one-shot target update is requested.
        if (status === 'applied' && !targetVersion) return { kind: 'done' }
        // absent + an external copy: a race already satisfied it — never lay down a
        // managed shadow copy over a bundled/system binary.
        if (status === 'absent' && (source === 'bundled' || source === 'system')) {
          logger.info('Skipping managed install; tool already available from an external source', { name, source })
          return { kind: 'done' }
        }

        // absent+none, broken, or applied+target → apply the exact recipe. The
        // returned concrete pin is intentionally ignored: name-only installs never
        // write Preference.
        try {
          const definitions = await this.appliedRuntimeDefinitions(this.getCustomDefinitions())
          // Invalidate before invoking mise: a failed command may still have made a
          // partial backend change, which must also stale any in-flight latest batch.
          this.bumpMutationRevision()
          await this.applyDefinition(definition, targetVersion, definitions)
          return { kind: 'done' }
        } catch (err) {
          return { kind: 'failed', error: err instanceof Error ? err.message : String(err) }
        }
      }
    )

    if (outcome.kind === 'done') {
      this.setOperation(name, null)
      return
    }
    if (outcome.kind === 'failed') {
      // Retain the update target so a Retry repeats the same targeted install; a
      // name-only retry of a failed update would hit the applied no-op and falsely
      // clear the failure without repeating the update.
      this.setOperation(name, {
        status: 'failed',
        action: 'install',
        error: outcome.error,
        ...(targetVersion ? { targetVersion } : {})
      })
      throw new Error(outcome.error)
    }
    // Unknown name: validation found no fixed/custom recipe, so there is no card
    // to carry a failed operation. Conflict/unknown application failures are
    // recorded above so an existing card can explain why Retry made no change.
    this.setOperation(name, null)
    throw new Error(outcome.error)
  }

  /**
   * Custom Add — the only route that accepts an arbitrary recipe. Validates
   * grammar, runtime canonicality, and collisions against the fixed catalog and
   * the custom registry, then persists the definition BEFORE any backend work so
   * the tool stays durably defined even if the install fails. A Preference write
   * failure aborts before touching the backend and rejects. Once persisted the
   * route resolves in every case — an applied or externally-satisfied tool is a
   * no-op, an absent one is installed, and a conflict / unreadable backend /
   * install failure becomes a failed operation the card can retry — so the Add
   * modal can always close. The persisted definition is never rewritten with a
   * resolved/installed version.
   */
  addCustomTool(definition: CustomToolDefinition): Promise<void> {
    try {
      this.validateCustomDefinition(definition, this.getCustomDefinitions())
    } catch (err) {
      return Promise.reject(err)
    }
    const active = this.activeMutations.get(definition.name)
    if (active) {
      if (active.action === 'addCustom' && this.sameDefinition(active.definition, definition)) return active.promise
      return Promise.reject(
        new Error(
          active.action === 'remove'
            ? `Tool ${definition.name} is already removing`
            : `Tool ${definition.name} is already installing`
        )
      )
    }

    this.setOperation(definition.name, { status: 'installing' })
    const promise = this.addCustomToolImpl(definition)
    this.activeMutations.set(definition.name, { action: 'addCustom', definition, promise })
    void promise
      .finally(() => {
        if (this.activeMutations.get(definition.name)?.promise === promise) this.activeMutations.delete(definition.name)
      })
      .catch(() => undefined)
    return promise
  }

  private async addCustomToolImpl(definition: CustomToolDefinition): Promise<void> {
    let persisted = false
    try {
      const result = await this.mutationMutex.runExclusive(
        async (): Promise<{ ok: true } | { ok: false; error: string }> => {
          // Re-validate against the current custom registry under the lock.
          this.validateCustomDefinition(definition, this.getCustomDefinitions())
          // Persist-first: the definition is durable before any backend command
          // runs, so a later install failure still leaves a removable, retry-able entry.
          await this.upsertCustomDefinition(definition)
          persisted = true

          // Same stale-PATH guard as installByNameImpl: the external-satisfied
          // no-op below must see a live system probe, not the boot-time capture.
          await refreshShellEnv()
          const snapshot = (await this.getToolSnapshots([definition.name]))[definition.name]
          const applicationFact = snapshot.application
          const status = applicationFact?.status
          const source = snapshot.availability.source
          if (applicationFact?.status === 'applied') {
            // `applied` proves the recipe's tool is active, not that the active
            // version satisfies this definition — adding node@20 over an active
            // node 22 must run the targeted install, not silently keep 22. Only a
            // provably matching version short-circuits; anything unprovable (no
            // active version, non-semver request) falls through to the apply
            // path, whose runtime-adoption rule makes the same conservative call.
            const requested = definition.requestedVersion ? semverValid(definition.requestedVersion) : null
            const matchesRequested =
              requested !== null &&
              applicationFact.version !== undefined &&
              semverValid(applicationFact.version) === requested
            if (!definition.requestedVersion || matchesRequested) return { ok: true }
          }
          if (status === 'absent' && (source === 'bundled' || source === 'system')) {
            logger.info('Custom tool already available from an external source; no managed copy', {
              name: definition.name,
              source
            })
            return { ok: true }
          }
          if (status === 'conflict') {
            return { ok: false, error: `Tool ${definition.name} resolves to a conflicting installation` }
          }
          if (status === 'unknown') {
            const reason = snapshot.application?.status === 'unknown' ? snapshot.application.reason : 'query_failed'
            return { ok: false, error: `Cannot determine ${definition.name} state: ${reason}` }
          }
          // absent+none, broken, or applied at a mismatched version → apply the
          // exact recipe. The custom definition is never rewritten with a
          // resolved version.
          try {
            const definitions = await this.appliedRuntimeDefinitions(this.getCustomDefinitions())
            // Persistence already invalidated earlier batches; bump again before
            // backend work so a batch started after that write cannot survive a
            // partial or successful mise mutation.
            this.bumpMutationRevision()
            await this.applyDefinition(definition, undefined, definitions)
            return { ok: true }
          } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) }
          }
        }
      )
      this.setOperation(
        definition.name,
        result.ok ? null : { status: 'failed', action: 'install', error: result.error }
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (persisted) {
        // Post-persistence failure (e.g. an unreadable backend while deciding):
        // keep the definition, record the failure, and still resolve so the modal closes.
        this.setOperation(definition.name, { status: 'failed', action: 'install', error: message })
        return
      }
      // Validation or the Preference write failed — no backend mutation happened,
      // so the route rejects and the transient operation is cleared.
      this.setOperation(definition.name, null)
      throw err
    }
  }

  private sameDefinition(a: CustomToolDefinition, b: CustomToolDefinition): boolean {
    return a.name === b.name && a.tool === b.tool && a.requestedVersion === b.requestedVersion
  }

  /**
   * Validate a Custom Add definition. Beyond the shared grammar/runtime checks it
   * enforces the fixed/custom boundary: a built-in name is reserved, an identical
   * same-name definition may retry but a divergent one is rejected, and the exact
   * recipe may not collide with a fixed definition or another custom name.
   */
  private validateCustomDefinition(definition: CustomToolDefinition, definitions: CustomToolDefinition[]) {
    this.validateDefinitionSpec(definition)
    if (this.resolveFixedDefinition(definition.name)) {
      throw new Error(`Tool ${definition.name} is a built-in tool and cannot be added as a custom tool`)
    }
    const sameName = definitions.find((entry) => entry.name === definition.name)
    if (sameName && !this.sameDefinition(sameName, definition)) {
      throw new Error(`Tool ${definition.name} is already defined with a different specification`)
    }
    const toolIdentity = normalizeToolIdentity(definition.tool)
    const fixedProvider = [...FIXED_CATALOG.values()].find(
      (entry) => normalizeToolIdentity(entry.tool) === toolIdentity
    )
    if (fixedProvider) {
      throw new Error(`Tool specification ${definition.tool} is already provided by ${fixedProvider.name}`)
    }
    const customProvider = definitions.find(
      (entry) => entry.name !== definition.name && normalizeToolIdentity(entry.tool) === toolIdentity
    )
    if (customProvider) {
      throw new Error(`Tool specification ${definition.tool} is already provided by ${customProvider.name}`)
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
   * Latest available registry version for each *applied* managed tool
   * (name → version). On demand only — never during boot — because `mise latest`
   * for github: backends hits the rate-limited GitHub releases API. Runs with a
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
    const result: Record<string, string> = {}
    if (!this.miseBin) return result

    // Capture the mutation revision before the slow queries; if any add / install
    // / update / remove lands while they run, the batch is stale and discarded.
    const revision = this.mutationRevision

    // Candidate recipes: every code-owned fixed definition plus the custom
    // registry, with a fixed name winning over a stale same-name custom entry.
    // A recipe is never treated as installed from Preference alone — only the live
    // application fact decides which recipes are eligible below.
    const candidates = new Map<string, CustomToolDefinition>()
    for (const [name, definition] of FIXED_CATALOG) candidates.set(name, definition)
    for (const entry of this.getCustomDefinitions()) if (!candidates.has(entry.name)) candidates.set(entry.name, entry)

    const names = [...candidates.keys()]
    const snapshots = await this.getToolSnapshots(names)
    // Only an exactly-applied recipe has a meaningful managed "latest": bundled /
    // system-only, absent, broken, conflict, and unknown are all excluded.
    const applied = names.filter((name) => snapshots[name]?.application?.status === 'applied')

    let cursor = 0
    const workers = Array.from({ length: Math.min(LATEST_VERSIONS_CONCURRENCY, applied.length) }, async () => {
      while (cursor < applied.length) {
        const name = applied[cursor++]
        const { tool } = candidates.get(name)!
        try {
          const { stdout } = await this.runMise(['latest', tool])
          const version = stdout.trim().split(/\r?\n/)[0]?.trim()
          if (version) result[name] = version
        } catch (err) {
          logger.warn('Failed to query latest version', {
            name,
            tool,
            error: this.errorMessage(err)
          })
        }
      }
    })
    await Promise.all(workers)

    if (applied.length > 0 && Object.keys(result).length === 0) {
      throw new Error('Failed to query latest versions for all applied tools')
    }

    return this.mutationMutex.runExclusive(async () => {
      if (this.mutationRevision !== revision) return {}
      application.get('CacheService').setShared('feature.binary.latest_versions', result)
      return result
    })
  }

  /**
   * Remove a tool by name. A fixed tool is cleaned from the backend but keeps its
   * built-in catalog identity (no Preference change); a custom tool is cleaned
   * and its durable definition dropped. `definitionOnly` drops just a custom
   * definition without touching the backend. The typed {@link BinaryRemoveResult}
   * lets the renderer branch on a fail-closed `cleanup_blocked` without parsing
   * text — nothing was removed and, for a custom tool, its definition is retained.
   */
  removeTool(request: BinaryRemoveRequest): Promise<BinaryRemoveResult> {
    const { name, definitionOnly = false } = request
    const fixed = this.resolveFixedDefinition(name)
    const custom = this.getCustomDefinitions().find((entry) => entry.name === name)
    // An unknown name addresses nothing removable.
    if (!fixed && !custom) {
      return Promise.reject(new Error(`Unknown tool: ${name}`))
    }
    // A fixed tool is code-owned: it has no durable definition to drop, so a
    // definition-only remove is a caller error, not a silent no-op.
    if (definitionOnly && fixed) {
      return Promise.reject(new Error(`Tool ${name} is a built-in tool and has no removable definition`))
    }

    const active = this.activeMutations.get(name)
    if (active) {
      if (active.action === 'remove' && active.definitionOnly === definitionOnly) return active.promise
      return Promise.reject(
        new Error(
          active.action === 'remove' ? `Tool ${name} is already removing` : `Tool ${name} is already installing`
        )
      )
    }

    // As with installs, expose removal before waiting for a mutation of another
    // tool. The active-mutation guard makes this state exclusively ours.
    this.setOperation(name, { status: 'removing' })
    const promise = this.removeToolImpl(name, definitionOnly)
    this.activeMutations.set(name, { action: 'remove', definitionOnly, promise })
    void promise
      .finally(() => {
        if (this.activeMutations.get(name)?.promise === promise) this.activeMutations.delete(name)
      })
      .catch(() => undefined)
    return promise
  }

  /**
   * Finds every backend-local package that would be stranded by removing a
   * runtime. Preference is only used to improve display names, never as proof
   * that a dependent exists.
   */
  private async installedRuntimeDependents(
    definition: CustomToolDefinition,
    definitions: CustomToolDefinition[]
  ): Promise<string[]> {
    if (!isRuntimeDependency(definition.tool)) return []
    const runtimeName = definition.tool.replace(/^core:/, '').split('@')[0]
    const dependentBackends = new Set(
      Object.entries(RUNTIME_DEPS)
        .filter(([, dep]) => dep.split('@')[0] === runtimeName)
        .map(([backend]) => backend)
    )
    if (dependentBackends.size === 0) return []

    // This full scan is deliberately separate from the targeted absence probe:
    // unreadable backend state must block a destructive runtime removal. `--installed`
    // is required: a plain `mise ls` also lists tools declared in config but not
    // installed (each carries `installed: false`), which would otherwise be counted
    // as a live dependent and block the runtime removal indefinitely.
    const { stdout } = await this.runMise(['ls', '--installed', '--json'])
    const installed: unknown = JSON.parse(stdout)
    if (!installed || typeof installed !== 'object' || Array.isArray(installed)) {
      throw new Error('mise returned invalid installed-tool state')
    }

    const nameForSpec = (spec: string): string =>
      definitions.find((entry) => entry.tool === spec)?.name ??
      PRESETS_BINARY_TOOLS.find((preset) => preset.tool === spec)?.name ??
      CODE_CLI_TOOL_PRESETS.find((preset) => preset.miseTool === spec)?.executable ??
      spec

    const dependents = new Set<string>()
    for (const [spec, entries] of Object.entries(installed)) {
      if (!Array.isArray(entries)) throw new Error(`mise returned invalid installed-tool state for ${spec}`)
      if (entries.length > 0 && dependentBackends.has(spec.split(':')[0])) dependents.add(nameForSpec(spec))
    }
    return [...dependents].sort()
  }

  private async removeToolImpl(name: string, definitionOnly: boolean): Promise<BinaryRemoveResult> {
    return this.mutationMutex.runExclusive(async (): Promise<BinaryRemoveResult> => {
      const fixed = this.resolveFixedDefinition(name)
      const definition = fixed ?? this.getCustomDefinitions().find((entry) => entry.name === name)
      const isCustom = !fixed
      // Guarded in removeTool, but the custom registry can shift before the lock: a
      // name that lost both its fixed and custom definition is already removed.
      if (!definition) {
        this.setOperation(name, null)
        return { status: 'removed' }
      }

      // Definition-only: drop the custom definition, never touch the backend.
      // (A fixed definition-only request was rejected in removeTool.)
      if (definitionOnly) {
        return this.deleteToolDefinition(name)
      }

      // A full remove chooses its cleanup path from the live application fact —
      // never the persisted definition — so it fails closed when the backend cannot
      // be read and never uninstalls over a foreign shim.
      const snapshot = (await this.getToolSnapshots([name]))[name]
      const application = snapshot.application

      // Backend unreadable / unavailable: nothing removed, definition retained.
      // Every blocked branch carries a human `message` so the renderer can show it
      // without parsing text — it branches on `reason`/`dependents`, never strings.
      if (application?.status === 'unknown') {
        this.setOperation(name, null)
        return {
          status: 'cleanup_blocked',
          reason: application.reason,
          message: `Cannot determine ${name} state to remove it (${application.reason})`
        }
      }
      // A foreign shim mise still resolves — uninstalling would shadow it.
      if (application?.status === 'conflict') {
        this.setOperation(name, null)
        return {
          status: 'cleanup_blocked',
          reason: 'conflict',
          message: `${name} resolves to a conflicting installation and cannot be safely removed`
        }
      }
      // Backend already clean: a fixed tool leaves Preference untouched; a custom
      // tool drops its definition. A Preference failure rejects with a failed op —
      // the next attempt re-enters here (backend still clean) and converges.
      if (application?.status === 'absent') {
        if (isCustom) return this.deleteToolDefinition(name)
        this.setOperation(name, null)
        return { status: 'removed' }
      }

      // applied or broken → the exact recipe is present; clean it up and verify.
      let dependents: string[]
      try {
        dependents = await this.installedRuntimeDependents(definition, this.getCustomDefinitions())
      } catch (err) {
        // Fail-closed: an unreadable dependent scan must never permit removal.
        this.setOperation(name, null)
        return { status: 'cleanup_blocked', reason: 'query_failed', message: this.errorMessage(err) }
      }
      if (dependents.length > 0) {
        this.setOperation(name, null)
        return {
          status: 'cleanup_blocked',
          reason: 'dependency_blocked',
          dependents,
          message: `Cannot remove ${name} while installed tools depend on it: ${dependents.join(', ')}`
        }
      }

      try {
        // Invalidate before destructive commands because a later failure can leave
        // the backend partially changed.
        this.bumpMutationRevision()
        await this.runMise(['unuse', '-g', definition.tool])
        await this.runMise(['uninstall', '--all', definition.tool])
        await this.runMise(['reshim'])
        if (!(await this.isMiseToolAbsent(definition.tool))) {
          this.setOperation(name, null)
          return {
            status: 'cleanup_blocked',
            reason: 'cleanup_failed',
            message: `Tool is still installed after removal: ${name}`
          }
        }
      } catch (err) {
        const message = this.errorMessage(err)
        logger.warn('Failed to clean up mise tool', { name, error: message })
        this.setOperation(name, null)
        return { status: 'cleanup_blocked', reason: 'cleanup_failed', message }
      }

      // Backend cleaned. Drop the custom definition; a fixed tool keeps its
      // built-in catalog identity. The backend mutation was recorded before the
      // destructive command sequence.
      if (isCustom) return this.deleteToolDefinition(name)
      this.setOperation(name, null)
      return { status: 'removed' }
    })
  }

  /**
   * Drop a custom tool's durable definition and clear its operation. A Preference
   * write failure rejects with a failed remove operation left in place — the next
   * remove re-enters the absent branch (backend already clean) and converges.
   */
  private async deleteToolDefinition(name: string): Promise<BinaryRemoveResult> {
    try {
      await this.removeCustomDefinition(name)
    } catch (err) {
      const message = this.errorMessage(err)
      logger.warn('Failed to remove tool definition', { name, error: message })
      this.setOperation(name, { status: 'failed', action: 'remove', error: message })
      throw err
    }
    this.setOperation(name, null)
    return { status: 'removed' }
  }

  /**
   * One-time hygiene pass over the persisted custom registry once the app is
   * ready. Purely a schema normalization — it reconstructs each entry to the
   * canonical `{name, tool, requestedVersion?}` shape (dropping extra fields and
   * mapping a legacy string `version` to `requestedVersion`), then filters
   * fixed-name entries, malformed entries, entries whose spec aliases a fixed
   * tool, and duplicate names/specs (first valid entry wins). It rewrites
   * Preference only when the normalized value differs from what is stored. It
   * never touches the filesystem, never invokes mise, and performs no
   * install/reconcile — a missing executable stays recoverable through the normal
   * install path, and a definition stays removable. Serialized on the mutation
   * mutex so it cannot interleave with a concurrent add/install/remove.
   */
  private async normalizeCustomDefinitions(): Promise<void> {
    if (this.isShuttingDown) return
    // Hygiene must never queue behind a user mutation and hold shutdown open for
    // that mutation's install timeout. Skipping is safe: mutations validate the
    // definitions they consume, and the one-time pass retries next launch.
    if (this.mutationMutex.isLocked()) {
      logger.info('Skipped binary custom registry normalization while a mutation is active')
      return
    }

    await this.mutationMutex.runExclusive(async () => {
      if (this.isShuttingDown) return
      let raw: unknown
      try {
        raw = application.get('PreferenceService').get('feature.binary.tools')
      } catch (err) {
        logger.warn('Failed to read binary custom registry for normalization', { error: this.errorMessage(err) })
        return
      }
      // Runtime input is untrusted: a non-array persisted value is unusable and is
      // reset to an empty registry.
      if (!Array.isArray(raw)) {
        if (raw !== undefined) await this.writeNormalizedDefinitions([], raw)
        return
      }

      const normalized: CustomToolDefinition[] = []
      const seenNames = new Set<string>()
      const seenSpecs = new Set<string>()
      const skipped: string[] = []
      const fixedSpecs = new Set([...FIXED_CATALOG.values()].map((entry) => normalizeToolIdentity(entry.tool)))
      for (const entry of raw) {
        const definition = this.reconstructCustomDefinition(entry)
        if (!definition) {
          skipped.push(this.describeSkipped(entry))
          continue
        }
        // A fixed name or a spec that aliases a fixed tool belongs to the code-owned
        // catalog, never the custom registry.
        const toolIdentity = normalizeToolIdentity(definition.tool)
        if (this.resolveFixedDefinition(definition.name) || fixedSpecs.has(toolIdentity)) {
          skipped.push(definition.name)
          continue
        }
        // Malformed name/tool/version and inconsistent runtime specs are dropped.
        try {
          this.validateDefinitionSpec(definition)
        } catch {
          skipped.push(definition.name)
          continue
        }
        // Deterministic dedupe by name and by spec — the first valid entry wins.
        if (seenNames.has(definition.name) || seenSpecs.has(toolIdentity)) {
          skipped.push(definition.name)
          continue
        }
        seenNames.add(definition.name)
        seenSpecs.add(toolIdentity)
        normalized.push(definition)
      }
      if (skipped.length > 0) {
        logger.info('Normalized binary custom registry; skipped invalid or reserved entries', { skipped })
      }
      // Write only when the normalized value differs from what is stored.
      if (!this.sameRegistry(raw, normalized)) {
        await this.writeNormalizedDefinitions(normalized, raw)
      }
    })
  }

  /**
   * Reconstruct one persisted entry into the canonical custom-definition shape,
   * treating the input as untrusted. Requires string `name`/`tool`; maps a legacy
   * string `version` to `requestedVersion` only when `requestedVersion` is absent;
   * drops every other field by rebuilding the object. Grammar is validated by the
   * caller. Returns null when the entry cannot be a definition at all.
   */
  private reconstructCustomDefinition(entry: unknown): CustomToolDefinition | null {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
    const source = entry as Record<string, unknown>
    if (typeof source.name !== 'string' || typeof source.tool !== 'string') return null
    const requestedVersion =
      typeof source.requestedVersion === 'string'
        ? source.requestedVersion
        : typeof source.version === 'string'
          ? source.version
          : undefined
    return { name: source.name, tool: source.tool, ...(requestedVersion ? { requestedVersion } : {}) }
  }

  /** A label for a skipped raw entry that never carried a usable name. */
  private describeSkipped(entry: unknown): string {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const name = (entry as Record<string, unknown>).name
      if (typeof name === 'string' && name) return name
    }
    return '<malformed>'
  }

  /**
   * Whether the stored registry already equals the normalized value — same length,
   * same order, and each entry carrying exactly the canonical fields with matching
   * values. An extra field, a legacy `version` key, or a reordering counts as a
   * difference so the one-time normalization write cleans it up.
   */
  private sameRegistry(raw: unknown[], normalized: CustomToolDefinition[]): boolean {
    if (raw.length !== normalized.length) return false
    return normalized.every((definition, index) => {
      const stored = raw[index]
      if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return false
      const record = stored as Record<string, unknown>
      const expectedKeys = definition.requestedVersion ? 3 : 2
      if (Object.keys(record).length !== expectedKeys) return false
      return (
        record.name === definition.name &&
        record.tool === definition.tool &&
        record.requestedVersion === definition.requestedVersion
      )
    })
  }

  /**
   * Persist the normalized registry and refresh derived views. A write failure is
   * logged and swallowed — a normalization pass must never brick startup — and the
   * subsequent cache/broadcast invalidation is already failure-tolerant.
   */
  private async writeNormalizedDefinitions(value: CustomToolDefinition[], previous: unknown): Promise<void> {
    try {
      await application.get('PreferenceService').set('feature.binary.tools', value)
    } catch (err) {
      logger.warn('Failed to persist normalized binary custom registry', {
        error: this.errorMessage(err),
        previousCount: Array.isArray(previous) ? previous.length : undefined
      })
      return
    }
    this.invalidateDerivedViews()
  }

  private errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
  }
}
