import type { ChildProcess } from 'node:child_process'
import { access, lstat, readFile, realpath, rm, unlink } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

import { valid, gt } from 'semver'

import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { regionService } from '@main/services/RegionService'
import { findExecutableInEnv } from '@main/utils/commandResolver'
import { isOutsidePath } from '@main/utils/file'
import { CHINA_NPM_REGISTRY, CHINA_PIP_INDEXES } from '@main/utils/packageRegistry'
import { crossPlatformSpawn, terminateProcessTree, waitForProcessExit } from '@main/utils/processRunner'
import { getRawShellEnv, refreshShellEnv } from '@main/utils/shellEnv'
import {
  LOCAL_AGENT_PRESETS,
  type LocalAgentPreset,
  type LocalAgentInstallResult,
  type LocalAgentUninstallComponent,
  type LocalAgentUninstallResult
} from '@shared/ai/localAgent'
import { CODE_CLI_TOOL_PRESET_BY_EXECUTABLE, type CodeCliToolPreset } from '@shared/data/presets/codeCliTools'
import type { BinaryInstallByNameRequest } from '@shared/types/binary'
import { LOCAL_AGENT_WEB_UI_IDS } from '@shared/types/managedTool'
import { redactSecretText } from '@shared/utils/redaction'

import { installBinaryAgent } from './installBinary'
import { readInstalledPackageVersion, resolveInstalledExecutable } from './installedVersion'
import { resolveInstallRecipe, resolveCliInstallRecipe } from './installRecipe'
import { selectAvailableInstallation } from './launch'
import { resolveRequiredRuntime } from './runtimeDependency'
import { getBinaryAgentInstallation, ownsNpmExecutable, ownsUvExecutable, uninstallBinaryAgent } from './uninstall'

const logger = loggerService.withContext('LocalAgentInstallService')
type InstallTarget = Pick<
  LocalAgentPreset,
  'id' | 'executable' | 'aliases' | 'npmPackage' | 'requiredRuntime' | 'terminalExecutable'
> & {
  protocol?: LocalAgentPreset['protocol']
  cli?: CodeCliToolPreset
}

const NATIVE_NPM_PACKAGES: Record<string, string> = { amp: '@ampcode/cli' }

const REGISTRY_URL = 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json'

@Injectable('LocalAgentInstallService')
@ServicePhase(Phase.Background)
@DependsOn(['BinaryManager'])
export class LocalAgentInstallService extends BaseService {
  private readonly operations = new Map<string, { version?: string; promise: Promise<LocalAgentInstallResult> }>()
  private readonly removals = new Map<string, Promise<LocalAgentUninstallResult>>()
  private readonly children = new Set<ChildProcess>()
  private abort = new AbortController()

  protected onInit() {
    this.abort = new AbortController()
  }

  install(presetId: string, targetVersion?: string): Promise<LocalAgentInstallResult> {
    const target = LOCAL_AGENT_PRESETS.find((entry) => entry.id === presetId)
    return target ? this.installTarget(target, targetVersion) : Promise.resolve({ ok: false, reason: 'unsupported' })
  }

  installCli({ name, targetVersion }: BinaryInstallByNameRequest): Promise<LocalAgentInstallResult> {
    const cli = CODE_CLI_TOOL_PRESET_BY_EXECUTABLE[name]
    return cli
      ? this.installTarget({ id: cli.id, executable: name, cli }, targetVersion)
      : Promise.resolve({ ok: false, reason: 'unsupported' })
  }

  private installTarget(target: InstallTarget, targetVersion?: string): Promise<LocalAgentInstallResult> {
    if (this.removals.size) return Promise.resolve({ ok: false, reason: 'failed' })
    const pending = this.operations.get(target.executable)
    if (pending)
      return pending.version === targetVersion ? pending.promise : Promise.resolve({ ok: false, reason: 'failed' })
    const operation = this.performInstall(target, targetVersion).finally(() =>
      this.operations.delete(target.executable)
    )
    this.operations.set(target.executable, { version: targetVersion, promise: operation })
    return operation
  }

  isUninstalling(presetId: string): boolean {
    const preset = LOCAL_AGENT_PRESETS.find((entry) => entry.id === presetId)
    return !!preset && [preset.executable, preset.terminalExecutable].some((name) => name && this.removals.has(name))
  }

  async getUninstallComponents(presetId: string, expectedPath: string): Promise<LocalAgentUninstallComponent[]> {
    const preset = LOCAL_AGENT_PRESETS.find((entry) => entry.id === presetId)
    return preset
      ? (await this.resolveUninstallComponents(preset, expectedPath)).map(({ executable, path }) => ({
          executable,
          path
        }))
      : []
  }

  uninstall(
    presetId: string,
    expectedPath: string,
    expectedComponents?: LocalAgentUninstallComponent[]
  ): Promise<LocalAgentUninstallResult> {
    const target = LOCAL_AGENT_PRESETS.find((entry) => entry.id === presetId)
    return target
      ? this.uninstallTarget(target, expectedPath, expectedComponents)
      : Promise.resolve({ ok: false, reason: 'unsupported' })
  }

  uninstallCli(name: string, expectedPath: string): Promise<LocalAgentUninstallResult> {
    const cli = CODE_CLI_TOOL_PRESET_BY_EXECUTABLE[name]
    return cli
      ? this.uninstallTarget({ id: cli.id, executable: name, cli }, expectedPath)
      : Promise.resolve({ ok: false, reason: 'unsupported' })
  }

  private async resolveUninstallComponents(target: InstallTarget, expectedPath: string) {
    const primary = await this.detect(target)
    if (primary.source === 'none' || primary.path !== expectedPath) return []
    const presets = target.cli
      ? LOCAL_AGENT_PRESETS.filter(
          (preset) => preset.executable === target.executable || preset.terminalExecutable === target.executable
        )
      : [target]
    const targets = new Map<string, InstallTarget>([[target.executable, target]])
    for (const preset of presets) {
      targets.set(preset.executable, preset)
      if (preset.terminalExecutable) {
        const executable = preset.terminalExecutable
        targets.set(executable, {
          id: preset.id,
          executable,
          cli: CODE_CLI_TOOL_PRESET_BY_EXECUTABLE[executable],
          npmPackage: NATIVE_NPM_PACKAGES[executable]
        })
      }
    }
    const installed = await Promise.all(
      [...targets.values()].map(async (target) => ({ target, detected: await this.detect(target) }))
    )
    return installed.flatMap(({ target, detected }) =>
      detected.source === 'none' ? [] : [{ executable: target.executable, path: detected.path, target }]
    )
  }

  private uninstallTarget(
    target: InstallTarget,
    expectedPath: string,
    expectedComponents?: LocalAgentUninstallComponent[]
  ): Promise<LocalAgentUninstallResult> {
    if (this.operations.size || this.removals.size) return Promise.resolve({ ok: false, reason: 'busy' })
    const operation = this.performUninstall(target, expectedPath, expectedComponents).finally(() =>
      this.removals.delete(target.executable)
    )
    this.removals.set(target.executable, operation)
    return operation
  }

  private async detect(target: InstallTarget) {
    const snapshots = await application
      .get('BinaryManager')
      .getToolSnapshots([target.executable, ...(target.aliases ?? [])])
    return selectAvailableInstallation(target, snapshots)
  }

  private closeIdleAgentSessions(presetIds: readonly string[]): Promise<boolean> {
    const targets = new Set(presetIds)
    const sessionIds = agentService
      .listAgents()
      .agents.filter(
        (agent) => agent.type === 'local' && targets.has(agent.configuration?.localRuntime?.presetId ?? '')
      )
      .flatMap((agent) => agentSessionService.listIdsByAgent(agent.id))
    return application.get('AgentSessionRuntimeService').closeIdleSessions(sessionIds)
  }

  async getVersion(presetId: string, latest: boolean) {
    const cli = presetId.startsWith('cli:') ? CODE_CLI_TOOL_PRESET_BY_EXECUTABLE[presetId.slice(4)] : undefined
    const target = cli
      ? { id: cli.id, executable: cli.executable, cli }
      : LOCAL_AGENT_PRESETS.find((entry) => entry.id === presetId)
    if (!target) return { canUpgrade: false }
    const detected = await this.detect(target)
    if (detected.source === 'none') return { canUpgrade: false }
    let current = 'version' in detected ? detected.version : await readInstalledPackageVersion(detected.path)
    if (!current) {
      const bundle = await getBinaryAgentInstallation(target.executable, detected.path).catch(() => undefined)
      const release = bundle && path.basename(bundle.bundle).slice(target.executable.length + 1, -7)
      current = valid(release) ?? undefined
    }
    if (!current) {
      try {
        const output = await this.run(detected.path, ['--version'], await getRawShellEnv(this.abort.signal), 8000)
        current = valid(output.trim()) ?? valid(output.match(/\b\d+\.\d+\.\d+(?:-[\w.-]+)?/)?.[0]) ?? undefined
      } catch {
        return { canUpgrade: false }
      }
    }
    if (!latest || !current) return { current, canUpgrade: false }
    try {
      const recipe = await this.recipe(target)
      let available: string | undefined
      if (recipe?.manager === 'binary' && (await getBinaryAgentInstallation(target.executable, detected.path)))
        available = recipe.version
      else if (recipe?.manager === 'npm' || recipe?.manager === 'uv') {
        const name = recipe.package.replace(recipe.manager === 'npm' ? /@[^@/]+$/ : /[=[].*$/, '')
        const url =
          recipe.manager === 'npm'
            ? `https://registry.npmjs.org/${encodeURIComponent(name)}/latest`
            : `https://pypi.org/pypi/${encodeURIComponent(name)}/json`
        const response = await fetch(url, { signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(10_000)]) })
        if (!response.ok) throw new Error(`Version lookup failed: HTTP ${response.status}`)
        const data = await response.json()
        available = valid(recipe.manager === 'npm' ? data.version : data.info?.version) ?? undefined
      }
      const newer = !!available && !!valid(current) && gt(available, current)
      return {
        current,
        latest: available,
        canUpgrade: newer && !!recipe && (await this.canUpgradeInstallation(recipe, target.executable, detected.path))
      }
    } catch (error) {
      logger.debug('Agent update lookup unavailable', { presetId, error })
      return { current, canUpgrade: false }
    }
  }

  private async recipe(target: InstallTarget, targetVersion?: string) {
    if (target.npmPackage && !LOCAL_AGENT_PRESETS.some((preset) => preset.executable === target.executable))
      return { manager: 'npm' as const, package: target.npmPackage, args: ['install', '--global', target.npmPackage] }
    const recipe = target.cli
      ? resolveCliInstallRecipe(target.cli, targetVersion)
      : (resolveInstallRecipe(target.id) ?? resolveInstallRecipe(target.id, await this.fetchRegistry()))
    if (!recipe || !targetVersion || target.cli || recipe.manager === 'script') return recipe
    if (!valid(targetVersion)) throw new Error('Invalid agent version')
    if (recipe.manager === 'binary') {
      if (recipe.version !== targetVersion) throw new Error('Agent release changed; check for updates again')
      return recipe
    }
    const packageName = recipe.package.replace(recipe.manager === 'npm' ? /@[^@/]+$/ : /==.*$/, '')
    const spec = `${packageName}${recipe.manager === 'npm' ? '@' : '=='}${targetVersion}`
    return {
      ...recipe,
      package: spec,
      args: recipe.args.map((arg) => (arg === recipe.package ? spec : arg))
    }
  }

  private async canUpgradeInstallation(
    recipe: NonNullable<Awaited<ReturnType<LocalAgentInstallService['recipe']>>>,
    executable: string,
    installedPath: string
  ) {
    if (recipe.manager === 'script') return false
    if (recipe.manager === 'binary') return !!(await getBinaryAgentInstallation(executable, installedPath))
    const env = await getRawShellEnv(this.abort.signal)
    const command = await findExecutableInEnv(recipe.manager, { env })
    if (!command || (await this.isManagedPath(command))) return false
    const root = (
      await this.run(command, recipe.manager === 'npm' ? ['root', '--global'] : ['tool', 'dir'], env, 8000)
    ).trim()
    if (await this.isManagedPath(root)) return false
    const name = recipe.package.replace(recipe.manager === 'npm' ? /@[^@/]+$/ : /[=[].*$/, '')
    return recipe.manager === 'npm'
      ? ownsNpmExecutable(root, name, installedPath)
      : ownsUvExecutable(root, name.toLowerCase().replace(/[-_.]+/g, '-'), installedPath)
  }

  private async verifyRemoved(file: string) {
    await lstat(file).then(
      () => {
        throw new Error('Installation files still exist after uninstall')
      },
      (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
      }
    )
  }

  private async removalAction(target: InstallTarget, expectedPath: string, env: Record<string, string>) {
    const detected = await this.detect(target)
    if (detected.source === 'none' || detected.path !== expectedPath) return undefined
    if (detected.source === 'mise') {
      const names = [target.executable, ...(target.aliases ?? [])]
      const manager = application.get('BinaryManager')
      const snapshots = await manager.getToolSnapshots(names)
      const name = names.find(
        (name) => snapshots[name]?.availability.source === 'mise' && snapshots[name]?.availability.path === expectedPath
      )
      if (!name) return undefined
      return async () => {
        const result = await manager.removeTool({ name })
        if (result.status !== 'removed') throw new Error(result.message ?? result.status)
      }
    }
    if (detected.source !== 'system') return undefined
    if (await getBinaryAgentInstallation(target.executable, expectedPath))
      return async () => {
        if (!(await uninstallBinaryAgent(target.executable, expectedPath))) throw new Error('Installation changed')
      }
    if (target.executable === 'traecli' && process.platform !== 'win32') {
      const bin = env.TRAECLI_INSTALL_DIR || env.XDG_BIN_HOME || application.getPath('external.acp.bin')
      if (path.resolve(expectedPath) !== path.join(bin, 'traecli')) return undefined
      const binary = await realpath(expectedPath)
      const statePath = env.TRAECLI_STATE_DIR || application.getPath('external.trae.installation')
      const state = await realpath(statePath).catch(() => statePath)
      const release = path.dirname(binary)
      const versioned = path.dirname(release) === path.join(state, 'releases') && path.basename(binary) === 'traex'
      if (
        !versioned &&
        binary !== path.join(await realpath(bin), 'traex') &&
        binary !== path.join(await realpath(bin), 'traecli')
      )
        return undefined
      if (versioned) {
        const receipt = JSON.parse(await readFile(path.join(release, 'trae-installation.json'), 'utf8'))
        if (typeof receipt.auto_update !== 'boolean' || typeof receipt.channel !== 'string') return undefined
        if ((await realpath(release)) !== release) return undefined
      }
      const help = await this.run(expectedPath, ['--help'], env, 8000, true)
      if (!/TRAE CLI/.test(help)) return undefined
      const original = await lstat(binary)
      return async () => {
        if (/app-server/.test(help)) await this.run(expectedPath, ['app-server', 'daemon', 'stop'], env, 30_000)
        const current = await lstat(binary)
        if (
          (await realpath(expectedPath)) !== binary ||
          current.ino !== original.ino ||
          current.mtimeMs !== original.mtimeMs
        )
          throw new Error('Installation changed')
        const entries: string[] = []
        for (const name of ['traecli', 'traex', 'coco', 'trae-cli', 'trae-agent', 'ta']) {
          const entry = path.join(bin, name)
          const stat = await lstat(entry).catch(() => undefined)
          if (stat?.isSymbolicLink() && (await realpath(entry).catch(() => undefined)) === binary) entries.push(entry)
        }
        for (const entry of entries) await unlink(entry)
        if (versioned) {
          const currentLink = path.join(state, 'current')
          if (
            (await lstat(currentLink).catch(() => undefined))?.isSymbolicLink() &&
            (await realpath(currentLink)) === release
          )
            await unlink(currentLink)
          await rm(release, { recursive: true })
        } else await unlink(binary)
      }
    }
    if (target.executable === 'hermes') {
      const help = await this.run(expectedPath, ['uninstall', '--help'], env, 8000, true).catch(() => '')
      if (/hermes/i.test(help) && /--yes\b/.test(help) && /--full\b/.test(help)) {
        const resolved = await realpath(expectedPath)
        const original = await lstat(resolved)
        return async () => {
          const current = await lstat(resolved)
          if (
            (await realpath(expectedPath)) !== resolved ||
            current.dev !== original.dev ||
            current.ino !== original.ino ||
            current.mtimeMs !== original.mtimeMs
          )
            throw new Error('Installation changed')
          // Without --full, Hermes preserves configuration, sessions and named profiles.
          await this.run(expectedPath, ['uninstall', '--yes'], env)
        }
      }
    }
    const recipe =
      target.executable === 'hermes' ? { manager: 'uv' as const, package: 'hermes-agent' } : await this.recipe(target)
    if (!recipe || recipe.manager === 'binary') return undefined
    if (recipe.manager === 'script') {
      const standalone =
        target.executable === 'agy'
          ? application.getPath('external.antigravity.cli.file')
          : target.executable === 'kiro-cli'
            ? application.getPath('external.acp.bin', 'kiro-cli')
            : undefined
      if (!standalone || path.resolve(expectedPath) !== standalone || !(await lstat(expectedPath)).isFile())
        return undefined
      const version = await this.run(expectedPath, ['--version'], env, 8000)
      const identity = target.executable === 'agy' ? /\b(?:antigravity|agy)\b/i : /\bkiro-cli\b/i
      if (!/\d+\.\d+/.test(version)) return undefined
      if (!identity.test(version) && !identity.test(await this.run(expectedPath, ['--help'], env, 8000, true)))
        return undefined
      const original = await lstat(expectedPath)
      return async () => {
        const current = await lstat(expectedPath)
        if (
          !current.isFile() ||
          current.dev !== original.dev ||
          current.ino !== original.ino ||
          current.mtimeMs !== original.mtimeMs
        )
          throw new Error('Installation changed')
        await unlink(expectedPath)
      }
    }
    const command = await findExecutableInEnv(recipe.manager, { env })
    if (!command || (await this.isManagedPath(command))) return undefined
    const root = (
      await this.run(command, recipe.manager === 'npm' ? ['root', '--global'] : ['tool', 'dir'], env)
    ).trim()
    if (await this.isManagedPath(root)) return undefined
    const name = recipe.package.replace(recipe.manager === 'npm' ? /@[^@/]+$/ : /[=[].*$/, '')
    const packageName = recipe.manager === 'uv' ? name.toLowerCase().replace(/[-_.]+/g, '-') : name
    const owns = () =>
      recipe.manager === 'npm'
        ? ownsNpmExecutable(root, packageName, expectedPath)
        : ownsUvExecutable(root, packageName, expectedPath)
    if (!(await owns())) return undefined
    return async () => {
      if (!(await owns())) throw new Error('Installation changed')
      await this.run(
        command,
        recipe.manager === 'npm' ? ['uninstall', '--global', packageName] : ['tool', 'uninstall', packageName],
        env
      )
      await this.verifyRemoved(path.join(root, packageName))
    }
  }

  private async performUninstall(
    preset: InstallTarget,
    expectedPath: string,
    expectedComponents?: LocalAgentUninstallComponent[]
  ): Promise<LocalAgentUninstallResult> {
    const removed: string[] = []
    let remaining: string[] = []
    try {
      this.abort.signal.throwIfAborted()
      await refreshShellEnv()
      const components = await this.resolveUninstallComponents(preset, expectedPath)
      if (
        !components.length ||
        (expectedComponents &&
          JSON.stringify(components.map(({ executable, path }) => ({ executable, path }))) !==
            JSON.stringify(expectedComponents))
      )
        return { ok: false, reason: 'changed' }
      remaining = components.map(({ executable }) => executable)
      const env = await getRawShellEnv(this.abort.signal)
      const agents = LOCAL_AGENT_PRESETS.filter((agent) =>
        components.some(({ executable }) => executable === agent.executable || executable === agent.terminalExecutable)
      )
      if (!(await this.closeIdleAgentSessions(agents.map((agent) => agent.id)))) return { ok: false, reason: 'busy' }
      for (const agent of agents) {
        const webUiId = LOCAL_AGENT_WEB_UI_IDS.find((id) => id === agent.id)
        if (webUiId) await application.get('LocalAgentWebUiService').stop(webUiId)
        if (agent.id === 'codebuddy-code') await application.get('CodeBuddyWebUiService').stop()
        if (agent.id === 'hermes') await application.get('HermesDashboardService').stop()
        if (agent.id === 'deepseek-harness') await application.get('DeepSeekHarnessService').stop()
        if (agent.id === 'openclaw') {
          const stopped = await application.get('OpenClawService').stopGateway()
          if (!stopped.success) return { ok: false, reason: 'busy' }
        }
      }
      const actions: Array<{ component: (typeof components)[number]; action: () => Promise<void> }> = []
      for (const component of components) {
        const action = await this.removalAction(component.target, component.path, env)
        if (!action) return { ok: false, reason: 'unsupported' }
        actions.push({ component, action })
      }
      for (const { component, action } of actions) {
        this.abort.signal.throwIfAborted()
        const current = await this.detect(component.target)
        if (current.source === 'none' || current.path !== component.path)
          return { ok: false, reason: removed.length ? 'partial' : 'changed', removed, remaining }
        await action()
        await this.verifyRemoved(component.path)
        removed.push(component.executable)
        remaining = remaining.filter((name) => name !== component.executable)
      }
      return { ok: true }
    } catch (error) {
      const detail = redactSecretText(error instanceof Error ? error.message : String(error)).slice(-2000)
      logger.warn('Local agent uninstall failed', { presetId: preset.id, detail })
      return {
        ok: false,
        reason: removed.length ? 'partial' : 'failed',
        detail,
        ...(removed.length ? { removed, remaining } : {})
      }
    } finally {
      await refreshShellEnv()
      application.get('IpcApiService').broadcast('binary.availability_changed', undefined)
    }
  }

  protected async onStop() {
    this.abort.abort()
    await Promise.all(
      [...this.children].map(async (child) => {
        await terminateProcessTree(child, false, 'local agent installation')
        if (!(await waitForProcessExit(child, 1000)))
          await terminateProcessTree(child, true, 'local agent installation')
      })
    )
    await Promise.allSettled([
      ...[...this.operations.values()].map(({ promise }) => promise),
      ...this.removals.values()
    ])
  }

  private async performInstall(preset: InstallTarget, targetVersion?: string): Promise<LocalAgentInstallResult> {
    const presetId = preset.id
    if (preset.executable === 'hermes' && targetVersion) return { ok: false, reason: 'unsupported' }
    try {
      this.abort.signal.throwIfAborted()
      await refreshShellEnv()
      const existing = await this.detect(preset)
      let env = await getRawShellEnv(this.abort.signal)
      const nativeCli = preset.terminalExecutable && CODE_CLI_TOOL_PRESET_BY_EXECUTABLE[preset.terminalExecutable]
      if (nativeCli) {
        const result = await this.installCli({ name: nativeCli.executable })
        if (!result.ok) return result
        env = await getRawShellEnv(this.abort.signal)
      }
      const executableDependencies = [
        ...(preset.requiredRuntime ? [{ executable: preset.requiredRuntime.executable, package: 'bun' }] : []),
        ...(preset.terminalExecutable && NATIVE_NPM_PACKAGES[preset.terminalExecutable]
          ? [{ executable: preset.terminalExecutable, package: NATIVE_NPM_PACKAGES[preset.terminalExecutable] }]
          : [])
      ]
      for (const dependency of executableDependencies) {
        const target = { id: presetId, executable: dependency.executable }
        const runtime =
          preset.requiredRuntime?.executable === dependency.executable ? preset.requiredRuntime : undefined
        const available = async () =>
          runtime ? !!(await resolveRequiredRuntime(runtime, env)) : (await this.detect(target)).source !== 'none'
        if (await available()) continue
        const failure = await this.installPackage(
          { manager: 'npm', package: dependency.package, args: ['install', '--global', dependency.package] },
          env
        )
        if (failure) return failure
        await refreshShellEnv()
        env = await getRawShellEnv(this.abort.signal)
        if (!(await available())) return { ok: false, reason: 'not_detected' }
      }
      if (existing.source !== 'none' && !targetVersion) {
        const failure = await this.ensureModelDependencies(preset, existing.path, env)
        if (failure) return failure
        application.get('IpcApiService').broadcast('binary.availability_changed', undefined)
        return { ok: true, reused: true, path: existing.path }
      }
      let recipe: Awaited<ReturnType<LocalAgentInstallService['recipe']>>
      try {
        recipe = await this.recipe(preset, targetVersion)
      } catch (error) {
        if (preset.cli) throw error
        return { ok: false, reason: 'registry' }
      }
      if (!recipe) return { ok: false, reason: 'unsupported' }
      if (
        targetVersion &&
        !preset.cli &&
        existing.source !== 'none' &&
        !(await this.canUpgradeInstallation(recipe, preset.executable, existing.path))
      )
        return { ok: false, reason: 'unsupported' }
      if (targetVersion && preset.protocol && !(await this.closeIdleAgentSessions([preset.id])))
        return { ok: false, reason: 'failed' }
      this.abort.signal.throwIfAborted()
      if (recipe.manager === 'binary') {
        const installedPath = await installBinaryAgent(
          preset.executable,
          recipe,
          AbortSignal.any([this.abort.signal, AbortSignal.timeout(10 * 60_000)]),
          targetVersion && existing.source !== 'none' ? existing.path : undefined
        )
        application.get('IpcApiService').broadcast('binary.availability_changed', undefined)
        return { ok: true, reused: false, path: installedPath }
      }
      if (recipe.manager === 'script') {
        const command = await findExecutableInEnv(recipe.command, { env })
        if (!command) return { ok: false, reason: 'unsupported' }
        await this.run(command, recipe.args, env)
        await refreshShellEnv()
        const installed = await this.detect(preset)
        application.get('IpcApiService').broadcast('binary.availability_changed', undefined)
        return installed.source === 'none'
          ? { ok: false, reason: 'not_detected' }
          : { ok: true, reused: false, path: installed.path }
      }
      const failure = await this.installPackage(recipe, env)
      if (failure) return failure
      await refreshShellEnv()
      const detected = await this.detect(preset)
      application.get('IpcApiService').broadcast('binary.availability_changed', undefined)
      if (detected.source === 'none') return { ok: false, reason: 'not_detected', manager: recipe.manager }
      const dependencyFailure = await this.ensureModelDependencies(preset, detected.path, env)
      if (dependencyFailure) return dependencyFailure
      return { ok: true, reused: false, path: detected.path }
    } catch (error) {
      if (this.abort.signal.aborted) return { ok: false, reason: 'stopping' }
      const detail = redactSecretText(error instanceof Error ? error.message : String(error)).slice(-2000)
      logger.warn('System agent installation failed', { presetId, detail })
      return { ok: false, reason: 'failed', detail }
    }
  }

  private async ensureModelDependencies(preset: InstallTarget, executable: string, env: Record<string, string>) {
    if (preset.id !== 'deepagents') return
    const require = createRequire(await resolveInstalledExecutable(executable))
    const packages = ['@langchain/anthropic', '@langchain/openai']
    const installed = async (name: string) =>
      (
        await Promise.all(
          (require.resolve.paths(name) ?? []).map((directory) =>
            access(path.join(directory, name, 'package.json')).then(
              () => true,
              () => false
            )
          )
        )
      ).some(Boolean)
    const available = await Promise.all(packages.map(installed))
    const missing = packages.filter((_, index) => !available[index])
    if (!missing.length) return
    if (await this.isManagedPath(executable)) return { ok: false as const, reason: 'unsupported' as const }
    const failure = await this.installPackage(
      { manager: 'npm', package: missing[0], args: ['install', '--global', ...missing] },
      env
    )
    if (failure) return failure
    for (const name of missing) {
      if (!(await installed(name))) throw new Error(`Missing model dependency after installation: ${name}`)
    }
    return undefined
  }

  private async installPackage(
    recipe: { manager: 'npm' | 'uv'; package: string; args: string[] },
    env: Record<string, string>
  ): Promise<LocalAgentInstallResult | undefined> {
    const command = await findExecutableInEnv(recipe.manager, { env })
    if (!command) return { ok: false, reason: 'missing_runtime', manager: recipe.manager }
    if (await this.isManagedPath(command)) return { ok: false, reason: 'managed_runtime', manager: recipe.manager }
    // Refuse redirects into Cherry's managed environment, including package-manager config.
    const target = await this.run(command, recipe.manager === 'npm' ? ['prefix', '--global'] : ['tool', 'dir'], env)
    const binTarget = recipe.manager === 'uv' ? await this.run(command, ['tool', 'dir', '--bin'], env) : target
    if ((await this.isManagedPath(target.trim())) || (await this.isManagedPath(binTarget.trim())))
      return { ok: false, reason: 'managed_runtime', manager: recipe.manager }
    logger.info('Installing local agent in system environment', {
      manager: recipe.manager,
      package: recipe.package
    })
    const environments = await this.installEnvironments(recipe.manager, command, env)
    for (const [index, installEnv] of environments.entries()) {
      try {
        await this.run(command, recipe.args, installEnv, installEnv === env ? 15 * 60_000 : 3 * 60_000)
        break
      } catch (error) {
        this.abort.signal.throwIfAborted()
        if (index === environments.length - 1) throw error
        logger.info('Agent package mirror failed; trying next source', {
          package: recipe.package,
          manager: recipe.manager
        })
      }
    }
    return undefined
  }

  private async installEnvironments(manager: 'npm' | 'uv', command: string, env: Record<string, string>) {
    const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(3000)])
    const inChina = await regionService.isInChina(signal).catch(() => false)
    this.abort.signal.throwIfAborted()
    if (!inChina) return [env]
    if (manager === 'npm') {
      if (Object.keys(env).some((key) => key.toLowerCase() === 'npm_config_registry')) return [env]
      const registry = await this.run(command, ['config', 'get', 'registry', '--global'], env, 8000).catch(() => '')
      if (registry.trim().replace(/\/$/, '') !== 'https://registry.npmjs.org') return [env]
      return [{ ...env, NPM_CONFIG_REGISTRY: CHINA_NPM_REGISTRY }, env]
    }
    // An existing uv configuration keeps ownership of index and authentication policy.
    if (
      Object.keys(env).some((key) =>
        /^(UV_(INDEX|DEFAULT_INDEX|EXTRA_INDEX|CONFIG|NO_CONFIG|NO_INDEX|OFFLINE|FIND_LINKS)|PIP_|XDG_CONFIG)/i.test(
          key
        )
      )
    )
      return [env]
    if (['APPDATA', 'PROGRAMDATA'].some((key) => env[key] && env[key] !== process.env[key])) return [env]
    const configured = await Promise.all(
      ['external.uv.user_config_file' as const, 'external.uv.system_config_file' as const].map(async (key) =>
        access(application.getPath(key)).then(
          () => true,
          (error: NodeJS.ErrnoException) => error.code !== 'ENOENT'
        )
      )
    )
    if (configured.some(Boolean)) return [env]
    return [...CHINA_PIP_INDEXES.map((index) => ({ ...env, UV_DEFAULT_INDEX: index })), env]
  }

  private async fetchRegistry(): Promise<unknown> {
    const response = await fetch(REGISTRY_URL, {
      signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(30_000)])
    })
    if (!response.ok) throw new Error(`Registry HTTP ${response.status}`)
    return response.json()
  }

  private async isManagedPath(candidate: string): Promise<boolean> {
    if (!path.isAbsolute(candidate)) throw new Error('Package manager returned an invalid system path')
    const resolved = await realpath(candidate).catch(() => candidate)
    return [application.getPath('cherry.home'), application.getPath('feature.binary.data')].some(
      (root) => !isOutsidePath(path.relative(root, candidate)) || !isOutsidePath(path.relative(root, resolved))
    )
  }

  private run(
    command: string,
    args: string[],
    env: Record<string, string>,
    timeout = 15 * 60_000,
    includeStderr = false
  ): Promise<string> {
    this.abort.signal.throwIfAborted()
    return new Promise((resolve, reject) => {
      const child = crossPlatformSpawn(command, args, {
        env,
        cwd: application.getPath('sys.home'),
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe']
      })
      this.children.add(child)
      let stdout = ''
      let stderr = ''
      const timer = setTimeout(() => void terminateProcessTree(child, true, 'local agent installation'), timeout)
      child.stdout?.on('data', (data: Buffer) => {
        stdout = (stdout + data.toString()).slice(-16_384)
      })
      child.stderr?.on('data', (data: Buffer) => {
        stderr = (stderr + data.toString()).slice(-16_384)
      })
      child.once('error', reject)
      child.once('close', (code) => {
        clearTimeout(timer)
        this.children.delete(child)
        if (code === 0) resolve(includeStderr ? `${stdout}\n${stderr}` : stdout)
        else reject(new Error(stderr || `Installer exited with code ${code}`))
      })
    })
  }
}
