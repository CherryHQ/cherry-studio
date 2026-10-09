import type { ChildProcess } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isPathWithin } from '@main/utils/binaryEnv'
import { findExecutableInEnv } from '@main/utils/commandResolver'
import { crossPlatformSpawn, terminateProcessTree, waitForProcessExit } from '@main/utils/processRunner'
import { getRawShellEnv, refreshShellEnv } from '@main/utils/shellEnv'
import {
  LOCAL_AGENT_PRESETS,
  type LocalAgentInstallResult,
  type LocalAgentUninstallResult
} from '@shared/ai/localAgent'
import { redactSecretText } from '@shared/utils/redaction'

import { installBinaryAgent } from './installBinary'
import { resolveInstallRecipe } from './installRecipe'
import { detectLocalAgents } from './launch'
import { ownsNpmExecutable, ownsUvExecutable, uninstallBinaryAgent } from './uninstall'

const logger = loggerService.withContext('LocalAgentInstallService')
const REGISTRY_URL = 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json'

@Injectable('LocalAgentInstallService')
@ServicePhase(Phase.Background)
@DependsOn(['BinaryManager'])
export class LocalAgentInstallService extends BaseService {
  private readonly operations = new Map<string, Promise<LocalAgentInstallResult>>()
  private readonly removals = new Map<string, Promise<LocalAgentUninstallResult>>()
  private readonly children = new Set<ChildProcess>()
  private abort = new AbortController()

  protected onInit() {
    this.abort = new AbortController()
  }

  install(presetId: string): Promise<LocalAgentInstallResult> {
    if (this.removals.size) return Promise.resolve({ ok: false, reason: 'failed' })
    const pending = this.operations.get(presetId)
    if (pending) return pending
    const operation = this.performInstall(presetId).finally(() => this.operations.delete(presetId))
    this.operations.set(presetId, operation)
    return operation
  }

  isUninstalling(presetId: string): boolean {
    return this.removals.has(presetId)
  }

  uninstall(presetId: string, expectedPath: string): Promise<LocalAgentUninstallResult> {
    if (this.operations.size || this.removals.size) return Promise.resolve({ ok: false, reason: 'busy' })
    const operation = this.performUninstall(presetId, expectedPath).finally(() => this.removals.delete(presetId))
    this.removals.set(presetId, operation)
    return operation
  }

  private async performUninstall(presetId: string, expectedPath: string): Promise<LocalAgentUninstallResult> {
    const preset = LOCAL_AGENT_PRESETS.find((entry) => entry.id === presetId)
    if (!preset) return { ok: false, reason: 'unsupported' }
    try {
      this.abort.signal.throwIfAborted()
      await refreshShellEnv()
      const detected = (await detectLocalAgents()).find((entry) => entry.presetId === presetId)
      if (!detected?.path || detected.path !== expectedPath) return { ok: false, reason: 'changed' }
      if (!(await application.get('AgentSessionRuntimeService').closeLocalAgentForUninstall(presetId)))
        return { ok: false, reason: 'busy' }
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
        const recipe = resolveInstallRecipe(
          presetId,
          preset.protocol === 'acp' ? await this.fetchRegistry() : undefined
        )
        if (!recipe || recipe.manager === 'binary') return { ok: false, reason: 'unsupported' }
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
    await Promise.allSettled([...this.operations.values(), ...this.removals.values()])
  }

  private async performInstall(presetId: string): Promise<LocalAgentInstallResult> {
    const preset = LOCAL_AGENT_PRESETS.find((entry) => entry.id === presetId)
    if (!preset) return { ok: false, reason: 'unsupported' }
    try {
      this.abort.signal.throwIfAborted()
      await refreshShellEnv()
      const existing = (await detectLocalAgents()).find((entry) => entry.presetId === presetId)
      if (existing?.path) {
        application.get('IpcApiService').broadcast('binary.availability_changed', undefined)
        return { ok: true, reused: true, path: existing.path }
      }
      let recipe: ReturnType<typeof resolveInstallRecipe>
      try {
        const registry = preset.protocol === 'acp' ? await this.fetchRegistry() : undefined
        recipe = resolveInstallRecipe(presetId, registry)
      } catch {
        return { ok: false, reason: 'registry' }
      }
      if (!recipe) return { ok: false, reason: 'unsupported' }
      this.abort.signal.throwIfAborted()
      if (recipe.manager === 'binary') {
        const installedPath = await installBinaryAgent(
          preset.executable,
          recipe,
          AbortSignal.any([this.abort.signal, AbortSignal.timeout(10 * 60_000)])
        )
        application.get('IpcApiService').broadcast('binary.availability_changed', undefined)
        return { ok: true, reused: false, path: installedPath }
      }
      const env = await getRawShellEnv(this.abort.signal)
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
      await this.run(command, recipe.args, env)
      await refreshShellEnv()
      const detected = (await detectLocalAgents()).find((entry) => entry.presetId === presetId)
      application.get('IpcApiService').broadcast('binary.availability_changed', undefined)
      if (!detected?.path) return { ok: false, reason: 'not_detected', manager: recipe.manager }
      return { ok: true, reused: false, path: detected.path }
    } catch (error) {
      if (this.abort.signal.aborted) return { ok: false, reason: 'stopping' }
      const detail = redactSecretText(error instanceof Error ? error.message : String(error)).slice(-2000)
      logger.warn('System agent installation failed', { presetId, detail })
      return { ok: false, reason: 'failed', detail }
    }
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

  private run(command: string, args: string[], env: Record<string, string>): Promise<string> {
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
      const timer = setTimeout(() => void terminateProcessTree(child, true, 'local agent installation'), 15 * 60_000)
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
