import type { ChildProcess } from 'node:child_process'
import { access, realpath } from 'node:fs/promises'
import path from 'node:path'

import { valid, gt } from 'semver'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { regionService } from '@main/services/RegionService'
import { isPathWithin } from '@main/utils/binaryEnv'
import { findExecutableInEnv } from '@main/utils/commandResolver'
import { CHINA_NPM_REGISTRY, CHINA_PIP_INDEXES } from '@main/utils/packageRegistry'
import { crossPlatformSpawn, terminateProcessTree, waitForProcessExit } from '@main/utils/processRunner'
import { getRawShellEnv, refreshShellEnv } from '@main/utils/shellEnv'
import {
  LOCAL_AGENT_PRESETS,
  type LocalAgentPreset,
  type LocalAgentInstallResult,
  type LocalAgentUninstallResult
} from '@shared/ai/localAgent'
import { CODE_CLI_TOOL_PRESET_BY_EXECUTABLE, type CodeCliToolPreset } from '@shared/data/presets/codeCliTools'
import type { BinaryInstallByNameRequest } from '@shared/types/binary'
import { LOCAL_AGENT_WEB_UI_IDS } from '@shared/types/managedTool'
import { redactSecretText } from '@shared/utils/redaction'

import { installBinaryAgent } from './installBinary'
import { readInstalledPackageVersion } from './installedVersion'
import { resolveInstallRecipe, resolveCliInstallRecipe } from './installRecipe'
import { selectAvailableInstallation } from './launch'
import { getBinaryAgentInstallation, ownsNpmExecutable, ownsUvExecutable, uninstallBinaryAgent } from './uninstall'

const logger = loggerService.withContext('LocalAgentInstallService')
type InstallTarget = Pick<LocalAgentPreset, 'id' | 'executable' | 'aliases' | 'npmPackage' | 'requiredRuntime'> & {
  protocol?: LocalAgentPreset['protocol']
  cli?: CodeCliToolPreset
}

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
    return !!preset && this.removals.has(preset.executable)
  }

  uninstall(presetId: string, expectedPath: string): Promise<LocalAgentUninstallResult> {
    const target = LOCAL_AGENT_PRESETS.find((entry) => entry.id === presetId)
    return target ? this.uninstallTarget(target, expectedPath) : Promise.resolve({ ok: false, reason: 'unsupported' })
  }

  uninstallCli(name: string, expectedPath: string): Promise<LocalAgentUninstallResult> {
    const cli = CODE_CLI_TOOL_PRESET_BY_EXECUTABLE[name]
    return cli
      ? this.uninstallTarget({ id: cli.id, executable: name, cli }, expectedPath)
      : Promise.resolve({ ok: false, reason: 'unsupported' })
  }

  private uninstallTarget(target: InstallTarget, expectedPath: string): Promise<LocalAgentUninstallResult> {
    if (this.operations.size || this.removals.size) return Promise.resolve({ ok: false, reason: 'busy' })
    const operation = this.performUninstall(target, expectedPath).finally(() => this.removals.delete(target.executable))
    this.removals.set(target.executable, operation)
    return operation
  }

  private async detect(target: InstallTarget) {
    const snapshots = await application
      .get('BinaryManager')
      .getToolSnapshots([target.executable, ...(target.aliases ?? [])])
    return selectAvailableInstallation(target, snapshots)
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
    const recipe = target.cli
      ? resolveCliInstallRecipe(target.cli, targetVersion)
      : resolveInstallRecipe(
          target.id,
          target.protocol === 'acp' && target.id !== 'kimi' && !target.npmPackage
            ? await this.fetchRegistry()
            : undefined
        )
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
      args: recipe.manager === 'npm' ? ['install', '--global', spec] : ['tool', 'install', '--upgrade', spec]
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

  private async performUninstall(preset: InstallTarget, expectedPath: string): Promise<LocalAgentUninstallResult> {
    const presetId = preset.id
    try {
      this.abort.signal.throwIfAborted()
      await refreshShellEnv()
      const detected = await this.detect(preset)
      if (detected.source === 'none' || detected.path !== expectedPath) return { ok: false, reason: 'changed' }
      const agents = preset.cli
        ? LOCAL_AGENT_PRESETS.filter(
            (entry) => entry.executable === preset.executable || entry.terminalExecutable === preset.executable
          )
        : [preset]
      for (const agent of agents) {
        if (!(await application.get('AgentSessionRuntimeService').closeLocalAgentForUninstall(agent.id)))
          return { ok: false, reason: 'busy' }
        const webUiId = LOCAL_AGENT_WEB_UI_IDS.find((id) => id === agent.id)
        if (webUiId) await application.getOptional('LocalAgentWebUiService')?.stop(webUiId)
        if (agent.id === 'codebuddy-code') await application.getOptional('CodeBuddyWebUiService')?.stop()
        if (agent.id === 'hermes') await application.getOptional('HermesDashboardService')?.stop()
      }
      if (detected.source === 'mise') {
        const manager = application.get('BinaryManager')
        const names = [preset.executable, ...(preset.aliases ?? [])]
        const snapshots = await manager.getToolSnapshots(names)
        const name = names.find((name) => {
          const availability = snapshots[name]?.availability
          return availability?.source === 'mise' && availability.path === expectedPath
        })
        if (!name) return { ok: false, reason: 'changed' }
        const result = await manager.removeTool({ name })
        if (result.status !== 'removed') return { ok: false, reason: 'failed', detail: result.message }
      } else if (detected.source !== 'system') {
        return { ok: false, reason: 'unsupported' }
      } else if (!(await uninstallBinaryAgent(preset.executable, expectedPath))) {
        const recipe = await this.recipe(preset)
        if (!recipe || recipe.manager === 'binary' || recipe.manager === 'script')
          return { ok: false, reason: 'unsupported' }
        const env = await getRawShellEnv(this.abort.signal)
        const command = await findExecutableInEnv(recipe.manager, { env })
        if (!command || (await this.isManagedPath(command))) return { ok: false, reason: 'unsupported' }
        const root = (
          await this.run(command, recipe.manager === 'npm' ? ['root', '--global'] : ['tool', 'dir'], env)
        ).trim()
        if (await this.isManagedPath(root)) return { ok: false, reason: 'unsupported' }
        if (recipe.manager === 'npm') {
          const packageName = recipe.package.replace(/@[^@/]+$/, '')
          if (!(await ownsNpmExecutable(root, packageName, expectedPath))) return { ok: false, reason: 'unsupported' }
          await this.run(command, ['uninstall', '--global', packageName], env)
        } else {
          const packageName = recipe.package
            .split(/[=[]/)[0]
            .toLowerCase()
            .replace(/[-_.]+/g, '-')
          if (!(await ownsUvExecutable(root, packageName, expectedPath))) return { ok: false, reason: 'unsupported' }
          await this.run(command, ['tool', 'uninstall', packageName], env)
        }
      }
      return { ok: true }
    } catch (error) {
      const detail = redactSecretText(error instanceof Error ? error.message : String(error)).slice(-2000)
      logger.warn('Local agent uninstall failed', { presetId, detail })
      return { ok: false, reason: 'failed', detail }
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
    try {
      this.abort.signal.throwIfAborted()
      await refreshShellEnv()
      const existing = await this.detect(preset)
      if (existing.source !== 'none' && !targetVersion) {
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
      if (
        targetVersion &&
        preset.protocol &&
        !(await application.get('AgentSessionRuntimeService').closeLocalAgentForUninstall(preset.id))
      )
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
      const env = await getRawShellEnv(this.abort.signal)
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
      if (preset.requiredRuntime && !(await findExecutableInEnv(preset.requiredRuntime, { env }))) {
        return { ok: false, reason: 'missing_runtime', manager: preset.requiredRuntime }
      }
      const command = await findExecutableInEnv(recipe.manager, { env })
      if (!command) return { ok: false, reason: 'missing_runtime', manager: recipe.manager }
      if (await this.isManagedPath(command)) return { ok: false, reason: 'managed_runtime', manager: recipe.manager }
      // Refuse redirects into Cherry's managed environment, including package-manager config.
      const target = await this.run(command, recipe.manager === 'npm' ? ['prefix', '--global'] : ['tool', 'dir'], env)
      const binTarget = recipe.manager === 'uv' ? await this.run(command, ['tool', 'dir', '--bin'], env) : target
      if ((await this.isManagedPath(target.trim())) || (await this.isManagedPath(binTarget.trim())))
        return { ok: false, reason: 'managed_runtime', manager: recipe.manager }
      logger.info('Installing local agent in system environment', {
        presetId,
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
          logger.info('Agent package mirror failed; trying next source', { presetId, manager: recipe.manager })
        }
      }
      await refreshShellEnv()
      const detected = await this.detect(preset)
      application.get('IpcApiService').broadcast('binary.availability_changed', undefined)
      if (detected.source === 'none') return { ok: false, reason: 'not_detected', manager: recipe.manager }
      return { ok: true, reused: false, path: detected.path }
    } catch (error) {
      if (this.abort.signal.aborted) return { ok: false, reason: 'stopping' }
      const detail = redactSecretText(error instanceof Error ? error.message : String(error)).slice(-2000)
      logger.warn('System agent installation failed', { presetId, detail })
      return { ok: false, reason: 'failed', detail }
    }
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
      (root) => isPathWithin(root, candidate) || isPathWithin(root, resolved)
    )
  }

  private run(command: string, args: string[], env: Record<string, string>, timeout = 15 * 60_000): Promise<string> {
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
        if (code === 0) resolve(stdout)
        else reject(new Error(stderr || `Installer exited with code ${code}`))
      })
    })
  }
}
