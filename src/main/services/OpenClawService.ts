import { execSync, spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { Socket } from 'node:net'
import os from 'node:os'
import path from 'node:path'

import { application } from '@application'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import { getBaseUrl } from '@main/ai/utils/provider'
import { isWin } from '@main/constant'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { WindowType } from '@main/core/window/types'
import { isUserInChina } from '@main/utils/ipService'
import { crossPlatformSpawn, findExecutableInEnv, getBinaryPath, runInstallScript } from '@main/utils/process'
import getShellEnv, { refreshShellEnv } from '@main/utils/shell-env'
import type { OperationResult } from '@shared/config/types'
import { ENDPOINT_TYPE, type Model, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { IpcChannel } from '@shared/IpcChannel'
import { withoutTrailingSlash } from '@shared/utils'
import { isVertexProvider } from '@shared/utils/provider'

import { vertexAIService } from './VertexAIService'

const logger = loggerService.withContext('OpenClawService')

/**
 * Parse the current version from `openclaw --version` output.
 * Example input: "OpenClaw 2026.3.9 (fe96034)"
 */
export function parseCurrentVersion(versionOutput: string): string | null {
  const match = versionOutput.match(/OpenClaw\s+([\d.]+)/i)
  return match?.[1] ?? null
}

/**
 * Parse the update status from `openclaw update status` output.
 * Returns the latest version string if a **binary** update is available, otherwise null.
 *
 * Cherry Studio installs OpenClaw as a standalone binary, so we only care about
 * binary-channel updates. npm/pkg-channel updates are ignored because they
 * require a different upgrade path (`npm update -g`).
 *
 * The table output contains a row like:
 *   │ Update   │ available · binary · 2026.3.12 │
 * And a summary line like:
 *   Update available (binary 2026.3.12). Run: openclaw update
 */
export function parseUpdateStatus(statusOutput: string): string | null {
  // Match binary-channel update from table row: "available · binary · <version>"
  const tableMatch = statusOutput.match(/available\s*·\s*binary\s*·?\s*([\d.]+)/i)
  if (tableMatch) return tableMatch[1]

  // Match binary-channel update from summary line: "Update available (binary <version>)"
  const summaryMatch = statusOutput.match(/Update available\s*\(binary\s+([\d.]+)\)/i)
  if (summaryMatch) return summaryMatch[1]

  return null
}

const OPENCLAW_CONFIG_DIR = path.join(os.homedir(), '.openclaw')
const OPENCLAW_CONFIG_PATH = path.join(OPENCLAW_CONFIG_DIR, 'openclaw.json')
const OPENCLAW_CONFIG_BAK_PATH = path.join(OPENCLAW_CONFIG_DIR, 'openclaw.json.bak')
const OPENCLAW_LEGACY_CONFIG_PATH = path.join(OPENCLAW_CONFIG_DIR, 'openclaw.cherry.json')
const SYMLINK_PATH = '/usr/local/bin/openclaw'
const DEFAULT_GATEWAY_PORT = 18790

export type GatewayStatus = 'stopped' | 'starting' | 'running' | 'error'

export interface HealthInfo {
  status: 'healthy' | 'unhealthy'
  gatewayPort: number
}

export interface ChannelInfo {
  id: string
  name: string
  type: string
  status: 'connected' | 'disconnected' | 'error'
}

export interface OpenClawConfig {
  gateway?: {
    mode?: 'local' | 'remote'
    port?: number
    auth?: {
      token?: string
    }
  }
  agents?: {
    defaults?: {
      model?: {
        primary?: string
      }
    }
  }
  models?: {
    mode?: string
    providers?: Record<string, OpenClawProviderConfig>
  }
}

export interface OpenClawModelConfig {
  id: string
  name: string
  contextWindow?: number
  [key: string]: unknown
}

export interface OpenClawProviderConfig {
  baseUrl: string
  apiKey: string
  api: string
  models: OpenClawModelConfig[]
}

/**
 * OpenClaw API types
 * - 'openai-completions': For OpenAI-compatible chat completions API
 * - 'anthropic-messages': For Anthropic Messages API format
 */
const OPENCLAW_API_TYPES = {
  OPENAI: 'openai-completions',
  ANTHROPIC: 'anthropic-messages',
  OPENAI_RESPOSNE: 'openai-responses'
} as const

/**
 * Placeholder API keys for providers that don't require authentication.
 * OpenClaw requires a non-empty apiKey value even for local providers.
 * Keys are matched by provider id first, then by provider type.
 */
const NO_KEY_PLACEHOLDERS: Record<string, string> = {
  ollama: 'ollama',
  lmstudio: 'lmstudio'
}

/**
 * Preset provider ids that always use Anthropic API format.
 * Matched against `Provider.presetProviderId` (canonical preset id) — custom
 * providers fall through to the model-/endpoint-based heuristic below.
 */
const ANTHROPIC_ONLY_PRESETS = new Set(['anthropic', 'vertex-anthropic'])

/**
 * Preset provider id that uses the OpenAI Responses API.
 */
const OPENAI_RESPONSES_PRESET = 'openai-response'

/**
 * Check whether a model declares Anthropic-messages as a supported endpoint.
 */
function modelSupportsAnthropic(model: Model): boolean {
  return model.endpointTypes?.includes(ENDPOINT_TYPE.ANTHROPIC_MESSAGES) ?? false
}

@Injectable('OpenClawService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['WindowManager'])
export class OpenClawService extends BaseService {
  private gatewayStatus: GatewayStatus = 'stopped'
  private gatewayPort: number = DEFAULT_GATEWAY_PORT
  private gatewayAuthToken: string = ''

  public get gatewayUrl(): string {
    return `ws://127.0.0.1:${this.gatewayPort}/ws`
  }

  protected async onInit(): Promise<void> {
    this.registerIpcHandlers()
  }

  protected async onStop(): Promise<void> {
    await this.stopGateway()
  }

  private registerIpcHandlers(): void {
    this.ipcHandle(IpcChannel.OpenClaw_CheckInstalled, () => this.checkInstalled())
    this.ipcHandle(IpcChannel.OpenClaw_Install, () => this.install())
    this.ipcHandle(IpcChannel.OpenClaw_Uninstall, () => this.uninstall())
    this.ipcHandle(IpcChannel.OpenClaw_StartGateway, (_e, port?: number) => this.startGateway(port))
    this.ipcHandle(IpcChannel.OpenClaw_StopGateway, () => this.stopGateway())
    this.ipcHandle(IpcChannel.OpenClaw_GetStatus, () => this.getStatus())
    this.ipcHandle(IpcChannel.OpenClaw_CheckHealth, () => this.checkHealth())
    this.ipcHandle(IpcChannel.OpenClaw_GetDashboardUrl, () => this.getDashboardUrl())
    this.ipcHandle(IpcChannel.OpenClaw_SyncConfig, (_e, uniqueModelId: UniqueModelId) =>
      this.syncProviderConfig(uniqueModelId)
    )
    this.ipcHandle(IpcChannel.OpenClaw_GetChannels, () => this.getChannelStatus())
    this.ipcHandle(IpcChannel.OpenClaw_CheckUpdate, () => this.checkUpdate())
    this.ipcHandle(IpcChannel.OpenClaw_PerformUpdate, () => this.performUpdate())
  }

  /**
   * Check if OpenClaw is installed.
   * Only recognizes the local binary (~/.cherrystudio/bin/). If openclaw is found
   * in PATH but not locally, it's likely an old npm-installed version (possibly a
   * third-party fork with ads) and needs migration.
   */
  public async checkInstalled(): Promise<{ installed: boolean; path: string | null; needsMigration: boolean }> {
    const localPath = await getBinaryPath('openclaw')
    if (fs.existsSync(localPath)) {
      return { installed: true, path: localPath, needsMigration: false }
    }
    // Check if an old version exists in PATH (e.g. from npm install -g)
    const envPath = await findExecutableInEnv('openclaw')
    if (envPath) {
      return { installed: false, path: null, needsMigration: true }
    }
    return { installed: false, path: null, needsMigration: false }
  }

  /**
   * Find the openclaw executable. Only uses the local binary (~/.cherrystudio/bin/).
   * Never falls back to PATH to avoid running old npm-installed versions.
   */
  private async findOpenClawBinary(): Promise<string | null> {
    const localPath = await getBinaryPath('openclaw')
    if (fs.existsSync(localPath)) return localPath
    return null
  }

  /**
   * Send install progress to renderer
   */
  private sendInstallProgress(message: string, type: 'info' | 'warn' | 'error' = 'info') {
    application
      .get('WindowManager')
      .broadcastToType(WindowType.Main, IpcChannel.OpenClaw_InstallProgress, { message, type })
  }

  /**
   * Create a symlink in /usr/local/bin (macOS/Linux) or add bin dir to user PATH (Windows).
   * Removes any existing symlink first to ensure a clean state.
   */
  private async linkBinary(): Promise<void> {
    const binaryPath = await getBinaryPath('openclaw')
    if (isWin) {
      const binDir = await getBinaryPath()
      try {
        const regQuery = execSync('reg query "HKCU\\Environment" /v Path', { encoding: 'utf-8' })
        const currentPath = regQuery.match(/Path\s+REG_\w+\s+(.*)/)?.[1]?.trim() || ''
        if (!currentPath.split(';').some((p) => p.toLowerCase() === binDir.toLowerCase())) {
          const newPath = currentPath ? `${currentPath};${binDir}` : binDir
          execSync(`reg add "HKCU\\Environment" /v Path /t REG_EXPAND_SZ /d "${newPath}" /f`)
          // Broadcast WM_SETTINGCHANGE so new shells pick up the change
          execSync('setx OPENCLAW_PATH_REFRESH ""')
          logger.info(`Added ${binDir} to user PATH`)
        }
      } catch {
        // User PATH key may not exist yet
        execSync(`reg add "HKCU\\Environment" /v Path /t REG_EXPAND_SZ /d "${binDir}" /f`)
        logger.info(`Created user PATH with ${binDir}`)
      }
    } else {
      try {
        // Remove existing symlink or file at target path
        if (fs.existsSync(SYMLINK_PATH)) {
          fs.unlinkSync(SYMLINK_PATH)
        }
        fs.symlinkSync(binaryPath, SYMLINK_PATH)
        logger.info(`Created symlink: ${SYMLINK_PATH} -> ${binaryPath}`)
      } catch (err) {
        logger.warn(`Failed to create symlink at ${SYMLINK_PATH} (may need elevated permissions):`, err as Error)
      }
    }
  }

  /**
   * Remove the symlink from /usr/local/bin (macOS/Linux) or remove bin dir from user PATH (Windows).
   */
  private async unlinkBinary(): Promise<void> {
    if (isWin) {
      const binDir = await getBinaryPath()
      try {
        const regQuery = execSync('reg query "HKCU\\Environment" /v Path', { encoding: 'utf-8' })
        const currentPath = regQuery.match(/Path\s+REG_\w+\s+(.*)/)?.[1]?.trim() || ''
        const parts = currentPath.split(';').filter((p) => p.toLowerCase() !== binDir.toLowerCase())
        const newPath = parts.join(';')
        if (newPath) {
          execSync(`reg add "HKCU\\Environment" /v Path /t REG_EXPAND_SZ /d "${newPath}" /f`)
        } else {
          execSync('reg delete "HKCU\\Environment" /v Path /f')
        }
        logger.info(`Removed ${binDir} from user PATH`)
      } catch {
        logger.debug('No user PATH to clean up')
      }
    } else {
      try {
        if (fs.existsSync(SYMLINK_PATH)) {
          fs.unlinkSync(SYMLINK_PATH)
          logger.info(`Removed symlink: ${SYMLINK_PATH}`)
        }
      } catch (err) {
        logger.warn(`Failed to remove symlink at ${SYMLINK_PATH}:`, err as Error)
      }
    }
  }

  /**
   * Install OpenClaw by downloading the binary from releases.
   * Uses gitcode.com mirror for China users, GitHub releases for others.
   */
  public async install(): Promise<OperationResult> {
    try {
      this.sendInstallProgress('Checking download source...')
      const useMirror = await isUserInChina()
      const extraEnv: Record<string, string> = {}
      if (useMirror) {
        extraEnv.OPENCLAW_USE_MIRROR = '1'
        logger.info('Using gitcode mirror for OpenClaw download')
        this.sendInstallProgress('Using mirror source for download...')
      }

      this.sendInstallProgress('Downloading and installing OpenClaw...')
      await runInstallScript('install-openclaw.js', extraEnv)

      await this.linkBinary()

      this.sendInstallProgress('OpenClaw installed successfully!')
      logger.info('OpenClaw binary installed via install script')

      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('Failed to install OpenClaw:', error as Error)
      this.sendInstallProgress(errorMessage, 'error')
      return { success: false, message: errorMessage }
    }
  }

  /**
   * Uninstall OpenClaw by removing the binary from ~/.cherrystudio/bin/.
   */
  public async uninstall(): Promise<OperationResult> {
    // Stop the gateway before removing binary
    if (this.gatewayStatus === 'running') {
      await this.stopGateway()
    }

    try {
      const binaryName = isWin ? 'openclaw.exe' : 'openclaw'
      const binDir = await getBinaryPath()
      const binaryPath = path.join(binDir, binaryName)

      this.sendInstallProgress('Removing OpenClaw binary...')

      await this.unlinkBinary()

      if (fs.existsSync(binaryPath)) {
        fs.unlinkSync(binaryPath)
        logger.info(`Removed OpenClaw binary: ${binaryPath}`)
      }

      // Remove package.json (shipped with OpenClaw binary package)
      const packageJsonPath = path.join(binDir, 'package.json')
      if (fs.existsSync(packageJsonPath)) {
        fs.unlinkSync(packageJsonPath)
        logger.info(`Removed OpenClaw package.json: ${packageJsonPath}`)
      }

      // Also remove sidecar lib directory if present
      const libDir = path.join(binDir, 'lib')
      if (fs.existsSync(libDir)) {
        fs.rmSync(libDir, { recursive: true, force: true })
        logger.info('Removed sidecar lib directory')
      }

      this.sendInstallProgress('OpenClaw uninstalled successfully!')
      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('Failed to uninstall OpenClaw:', error as Error)
      this.sendInstallProgress(errorMessage, 'error')
      return { success: false, message: errorMessage }
    }
  }

  /**
   * Start the OpenClaw Gateway
   */
  public async startGateway(port?: number): Promise<OperationResult> {
    this.gatewayPort = port ?? DEFAULT_GATEWAY_PORT

    // Prevent concurrent startup calls
    if (this.gatewayStatus === 'starting') {
      return { success: false, message: 'Gateway is already starting' }
    }

    // Check if the port is already in use
    const isPortOpen = await this.checkPortOpen(this.gatewayPort)
    if (isPortOpen) {
      // Check if this is our gateway already running on this port
      const { status } = await this.checkGatewayHealth()
      if (status === 'healthy') {
        // Stop the stale gateway (e.g. respawned orphan from a previous session)
        logger.info('Detected stale gateway on port, stopping before restart...')
        await this.stopGateway()

        // Verify port is now free
        const stillOpen = await this.checkPortOpen(this.gatewayPort)
        if (stillOpen) {
          return {
            success: false,
            message: `Port ${this.gatewayPort} is still in use after stopping the old gateway.`
          }
        }
      } else {
        return {
          success: false,
          message: `Port ${this.gatewayPort} is already in use by another application. Please choose a different port.`
        }
      }
    }

    // Refresh shell env first so crossPlatformSpawn uses a fresh env
    const shellEnv = await refreshShellEnv()
    const openclawPath = await this.findOpenClawBinary()
    if (!openclawPath) {
      return {
        success: false,
        message: 'OpenClaw binary not found. Please install OpenClaw first.'
      }
    }

    this.gatewayStatus = 'starting'

    try {
      await this.startAndWaitForGateway(openclawPath, shellEnv)
      this.gatewayStatus = 'running'
      logger.info(`Gateway started on port ${this.gatewayPort}`)
      return { success: true }
    } catch (error) {
      this.gatewayStatus = 'error'
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('Failed to start gateway:', error as Error)
      return { success: false, message: errorMessage }
    }
  }

  /**
   * Start gateway via `openclaw gateway run --force` and wait for it to become ready.
   * Spawns the gateway as a detached process so its lifecycle is independent.
   * Uses process termination to stop it later.
   */
  private async startAndWaitForGateway(openclawPath: string, shellEnv: Record<string, string>): Promise<void> {
    const args = ['gateway', 'run', '--force']

    logger.info(`Starting gateway: ${openclawPath} ${args.join(' ')}`)

    // Spawn the gateway process. We poll for readiness via health check.
    // On Windows, avoid detached: true as it creates a visible console window.
    // Instead, use windowsHide: true without detached - proc.unref() ensures
    // the parent can exit independently.
    const proc = spawn(openclawPath, args, {
      env: shellEnv,
      detached: !isWin, // Only detach on non-Windows to avoid console flash
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    proc.unref()

    // Collect early exit errors (e.g. binary crash on startup)
    let earlyExitError = ''
    let stdoutOutput = ''
    let stderrOutput = ''
    proc.stdout?.on('data', (data) => {
      stdoutOutput += data.toString()
    })
    proc.stderr?.on('data', (data) => {
      stderrOutput += data.toString()
    })
    proc.on('error', (err) => {
      earlyExitError = err.message
    })
    proc.on('exit', (code) => {
      // Capture output from both streams for diagnostics
      const combinedOutput = [stderrOutput.trim(), stdoutOutput.trim()].filter(Boolean).join('\n')
      const detail = combinedOutput.split('\n').filter(Boolean).slice(0, 5).join('\n')
      if (code !== 0) {
        earlyExitError = detail || `gateway exited with code ${code}`
      } else {
        // Process exited with code 0 but gateway may not be healthy (e.g. daemonized child failed)
        earlyExitError = detail
          ? `gateway exited with code 0 but output: ${detail}`
          : 'gateway process exited with code 0 before becoming healthy'
      }
    })

    // Wait for gateway to become ready (max 30 seconds)
    const maxWaitMs = 30000
    const pollIntervalMs = 1000
    const startTime = Date.now()
    let pollCount = 0
    let lastError = ''

    while (Date.now() - startTime < maxWaitMs) {
      await new Promise((r) => setTimeout(r, pollIntervalMs))
      pollCount++

      // Check if the process crashed early
      if (earlyExitError) {
        throw new Error(earlyExitError)
      }

      logger.debug(`Polling gateway health (attempt ${pollCount})...`)
      const { status, error: healthError } = await this.checkGatewayHealthWithError()
      if (status === 'healthy') {
        logger.info(`Gateway is healthy (verified after ${pollCount} polls)`)
        return
      }
      if (healthError) lastError = healthError
    }

    // Combine all available diagnostics: health check errors, stderr, and stdout
    const diagnostics = [
      lastError ? `health: ${lastError}` : '',
      stderrOutput.trim() ? `stderr: ${stderrOutput.trim().split('\n').slice(0, 5).join('\n')}` : '',
      stdoutOutput.trim() ? `stdout: ${stdoutOutput.trim().split('\n').slice(0, 5).join('\n')}` : ''
    ]
      .filter(Boolean)
      .join('\n')
    const detail = diagnostics ? `\n${diagnostics}` : ''
    throw new Error(`Gateway failed to start within ${maxWaitMs}ms (${pollCount} polls)${detail}`)
  }

  /**
   * Stop the OpenClaw Gateway.
   * Kills all openclaw processes to ensure clean shutdown.
   */
  public async stopGateway(): Promise<OperationResult> {
    try {
      this.killAllOpenClawProcesses()

      const stillRunning = await this.waitForGatewayStop()
      if (stillRunning) {
        this.gatewayStatus = 'error'
        return { success: false, message: 'Failed to stop gateway' }
      }

      this.gatewayStatus = 'stopped'
      logger.info('Gateway stopped')
      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('Failed to stop gateway:', error as Error)
      this.gatewayStatus = 'error'
      return { success: false, message: errorMessage }
    }
  }

  /**
   * Kill all openclaw processes by finding processes on the gateway port.
   * This works reliably on Windows where process name may show as bun.exe.
   */
  private killAllOpenClawProcesses(): void {
    const currentPid = process.pid
    try {
      if (isWin) {
        const output = execSync(`netstat -ano | findstr ":${this.gatewayPort}"`, { encoding: 'utf-8' })
        const pids = new Set<string>()
        for (const line of output.split('\n')) {
          const match = line.trim().match(/LISTENING\s+(\d+)/)
          if (match && Number(match[1]) !== currentPid) {
            pids.add(match[1])
          }
        }
        for (const pid of pids) {
          try {
            execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' })
            logger.info(`Killed process ${pid} on port ${this.gatewayPort}`)
          } catch {
            // ignore
          }
        }
      } else {
        execSync('pkill -9 openclaw', { stdio: 'ignore' })
        logger.info('Killed all openclaw processes')
      }
    } catch {
      logger.debug('No openclaw processes to kill')
    }
  }

  /**
   * Wait for gateway to actually stop, with retries.
   * Returns true if gateway is still running after all retries.
   */
  private async waitForGatewayStop(maxRetries = 3, intervalMs = 1000): Promise<boolean> {
    for (let i = 0; i < maxRetries; i++) {
      const { status } = await this.checkGatewayHealth()
      const stillRunning = status === 'healthy'
      if (!stillRunning) {
        return false
      }
      if (i < maxRetries - 1) {
        logger.debug(`Gateway still running after stop, retrying check (${i + 1}/${maxRetries})...`)
        await new Promise((r) => setTimeout(r, intervalMs))
      }
    }
    return true
  }

  private async execOpenClawCommandWithResult(
    openclawPath: string,
    args: string[],
    env: Record<string, string>,
    timeoutMs = 20000
  ): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const proc = crossPlatformSpawn(openclawPath, args, { env })

      let stdout = ''
      let stderr = ''

      proc.stdout?.on('data', (data) => {
        stdout += data.toString()
      })
      proc.stderr?.on('data', (data) => {
        stderr += data.toString()
      })

      const timeout = setTimeout(() => {
        logger.warn(`Gateway command timed out: ${args.join(' ')}`)
        proc.kill('SIGKILL')
        resolve({ code: null, stdout, stderr })
      }, timeoutMs)

      proc.on('exit', (code) => {
        clearTimeout(timeout)
        logger.info(`Gateway command [${args.join(' ')}]:`, { code, stdout: stdout.trim(), stderr: stderr.trim() })
        resolve({ code, stdout, stderr })
      })

      proc.on('error', (err) => {
        clearTimeout(timeout)
        logger.error(`Gateway command error [${args.join(' ')}]:`, err)
        resolve({ code: null, stdout, stderr: err.message })
      })
    })
  }

  /**
   * Get Gateway status. Probes the port when idle to detect externally-started gateways.
   */
  public async getStatus(): Promise<{ status: GatewayStatus; port: number }> {
    if (this.gatewayStatus === 'starting') {
      return { status: this.gatewayStatus, port: this.gatewayPort }
    }

    const { status } = await this.checkGatewayHealth()
    if (status === 'healthy' && this.gatewayStatus !== 'running') {
      logger.info(`Detected externally running gateway on port ${this.gatewayPort}`)
      this.gatewayStatus = 'running'
    } else if (status === 'unhealthy' && this.gatewayStatus === 'running') {
      logger.warn(`Gateway on port ${this.gatewayPort} is no longer reachable, marking as stopped`)
      this.gatewayStatus = 'stopped'
    }

    return {
      status: this.gatewayStatus,
      port: this.gatewayPort
    }
  }

  /**
   * Check Gateway health (public API).
   * Returns unhealthy immediately if we know the gateway is not running.
   */
  public async checkHealth(): Promise<HealthInfo> {
    if (this.gatewayStatus !== 'running') {
      return { status: 'unhealthy', gatewayPort: this.gatewayPort }
    }
    const healthInfo = await this.checkGatewayHealth()
    if (healthInfo.status === 'unhealthy') {
      logger.warn(`Gateway health check failed, marking as stopped`)
      this.gatewayStatus = 'stopped'
    }
    return healthInfo
  }

  /**
   * Probe gateway health via HTTP request to the health endpoint.
   * This is faster than spawning the openclaw binary.
   * Expected response: {"ok":true,"status":"live"}
   * Does NOT check gatewayStatus — callers that need to detect
   * externally-started gateways should call this directly.
   */
  private async checkGatewayHealth(): Promise<HealthInfo> {
    try {
      const response = await fetch(`http://127.0.0.1:${this.gatewayPort}/health`, {
        signal: AbortSignal.timeout(3000)
      })
      if (response.ok) {
        const data = (await response.json()) as { ok?: boolean; status?: string }
        if (data.ok && data.status === 'live') {
          return { status: 'healthy', gatewayPort: this.gatewayPort }
        }
      }
    } catch (error) {
      logger.debug('Health probe failed:', error as Error)
    }
    return { status: 'unhealthy', gatewayPort: this.gatewayPort }
  }

  /**
   * Check if a port is open and accepting connections
   */
  private async checkPortOpen(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new Socket()
      socket.setTimeout(2000)

      socket.on('connect', () => {
        socket.destroy()
        logger.debug(`Port ${port} is open (connected)`)
        resolve(true)
      })

      socket.on('timeout', () => {
        socket.destroy()
        logger.debug(`Port ${port} check timed out`)
        resolve(false)
      })

      socket.on('error', (err) => {
        socket.destroy()
        logger.debug(`Port ${port} is not open: ${err.message}`)
        resolve(false)
      })

      socket.connect(port, '127.0.0.1')
    })
  }

  /**
   * Get OpenClaw Dashboard URL (for opening in miniapp).
   * The Control UI uses #token= to bootstrap WebSocket authentication while
   * keeping the token client-side instead of sending it in HTTP requests.
   */
  public getDashboardUrl(): string {
    // Ensure we have the token (may have been lost after app restart)
    if (!this.gatewayAuthToken) {
      this.loadAuthTokenFromConfig()
    }
    if (!this.gatewayAuthToken) {
      throw new Error('OpenClaw dashboard auth token is missing')
    }
    const url = `http://127.0.0.1:${this.gatewayPort}`
    return `${url}#token=${encodeURIComponent(this.gatewayAuthToken)}`
  }

  /**
   * Load auth token from the config file (for recovery after app restart).
   */
  private loadAuthTokenFromConfig(): void {
    try {
      if (fs.existsSync(OPENCLAW_CONFIG_PATH)) {
        const content = fs.readFileSync(OPENCLAW_CONFIG_PATH, 'utf-8')
        const config = JSON.parse(content) as OpenClawConfig
        const token = config.gateway?.auth?.token
        if (token) {
          this.gatewayAuthToken = token
          logger.info('Recovered auth token from config file')
        }
      }
    } catch (error) {
      logger.warn('Failed to load auth token from config file', error as Error)
    }
  }

  /**
   * Generate a cryptographically secure random auth token
   */
  private generateAuthToken(): string {
    return crypto.randomBytes(24).toString('base64url')
  }

  public async syncProviderConfig(uniqueModelId: UniqueModelId): Promise<OperationResult> {
    try {
      // Resolve canonical provider + model from v2 SQLite. The providerId is
      // encoded in `uniqueModelId` (`providerId::modelId`), so the renderer
      // only needs to ship one id. Both lookups throw a typed DataApiError on
      // miss; we let those bubble to the `catch` below.
      const { providerId, modelId: apiModelId } = parseUniqueModelId(uniqueModelId)
      const provider = await providerService.getByProviderId(providerId)
      const primaryModel = await modelService.getByKey(providerId, apiModelId)

      // Ensure config directory exists
      if (!fs.existsSync(OPENCLAW_CONFIG_DIR)) {
        fs.mkdirSync(OPENCLAW_CONFIG_DIR, { recursive: true })
      }

      // Migrate legacy openclaw.cherry.json → openclaw.json
      if (fs.existsSync(OPENCLAW_LEGACY_CONFIG_PATH)) {
        if (fs.existsSync(OPENCLAW_CONFIG_PATH)) {
          fs.renameSync(OPENCLAW_CONFIG_PATH, OPENCLAW_CONFIG_BAK_PATH)
          logger.info('Migrated openclaw.json → openclaw.json.bak')
        }
        fs.renameSync(OPENCLAW_LEGACY_CONFIG_PATH, OPENCLAW_CONFIG_PATH)
        logger.info('Migrated openclaw.cherry.json → openclaw.json')
      }

      // Read existing config
      let config: OpenClawConfig = {}
      if (fs.existsSync(OPENCLAW_CONFIG_PATH)) {
        try {
          const content = fs.readFileSync(OPENCLAW_CONFIG_PATH, 'utf-8')
          config = JSON.parse(content)
        } catch {
          logger.warn('Failed to parse existing OpenClaw config, creating new one')
        }
      }

      // Determine API type. Order mirrors v1: preset-level "always anthropic"
      // wins, then per-model endpoint declaration, then the presence of an
      // anthropic-messages endpoint config (custom providers exposing it),
      // then preset-level openai-responses, otherwise plain openai-completions.
      const apiType = this.determineApiType(provider, primaryModel)
      const endpointForBaseUrl =
        apiType === OPENCLAW_API_TYPES.ANTHROPIC
          ? ENDPOINT_TYPE.ANTHROPIC_MESSAGES
          : apiType === OPENCLAW_API_TYPES.OPENAI_RESPOSNE
            ? ENDPOINT_TYPE.OPENAI_RESPONSES
            : ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS

      const baseUrl = withoutTrailingSlash(getBaseUrl(provider, endpointForBaseUrl))

      // API key — rotate across enabled keys via the v2 service, or fetch a
      // GCP access token for VertexAI from the provider's `iam-gcp` authConfig.
      let apiKey = await this.resolveApiKey(provider)

      // Providers like Ollama and LM Studio don't require real API keys,
      // but OpenClaw needs a non-empty placeholder value.
      if (!apiKey) {
        apiKey =
          NO_KEY_PLACEHOLDERS[provider.id] ??
          (provider.presetProviderId ? NO_KEY_PLACEHOLDERS[provider.presetProviderId] : undefined) ??
          'no-key-required'
      }

      // Build provider key + load full model list from v2 (one round-trip).
      const providerKey = `cherry-${provider.id}`
      const allModels = await modelService.list({ providerId })

      // Preserve existing model-level config that users may have modified in OpenClaw
      // (e.g., vision, custom context window, extra parameters).
      config.models = config.models || { mode: 'merge', providers: {} }
      config.models.providers = config.models.providers || {}
      const existingModels = config.models.providers[providerKey]?.models || []
      const existingModelMap = new Map(existingModels.map((m) => [m.id, m]))

      const openclawProvider: OpenClawProviderConfig = {
        baseUrl,
        apiKey,
        api: apiType,
        models: allModels.map((m) => {
          const id = m.apiModelId ?? parseUniqueModelId(m.id).modelId
          const existing = existingModelMap.get(id)
          return {
            ...existing,
            id,
            name: m.name,
            contextWindow: existing?.contextWindow ?? m.contextWindow ?? 128000
          }
        })
      }

      // Set gateway mode to local (required for gateway to start)
      config.gateway = config.gateway || {}
      config.gateway.mode = 'local'
      config.gateway.port = this.gatewayPort
      // Auto-generate auth token if not already set, and store it for API calls
      const token = this.gatewayAuthToken || this.generateAuthToken()
      config.gateway.auth = { token }
      this.gatewayAuthToken = token

      // Update config
      config.models.providers[providerKey] = openclawProvider

      // Set primary model
      const primaryApiModelId = primaryModel.apiModelId ?? parseUniqueModelId(primaryModel.id).modelId
      config.agents = config.agents || { defaults: {} }
      config.agents.defaults = config.agents.defaults || {}
      config.agents.defaults.model = {
        primary: `${providerKey}/${primaryApiModelId}`
      }

      // Write config file
      fs.writeFileSync(OPENCLAW_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')

      logger.info(`Synced provider ${provider.id} to OpenClaw config`)
      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('Failed to sync provider config:', error as Error)
      return { success: false, message: errorMessage }
    }
  }

  /**
   * Resolve the API key value for OpenClaw to embed in its config. Returns an
   * empty string when none is configured (caller substitutes a placeholder
   * for providers that don't require auth).
   */
  private async resolveApiKey(provider: Provider): Promise<string> {
    if (isVertexProvider(provider)) {
      try {
        const authConfig = await providerService.getAuthConfig(provider.id)
        if (authConfig?.type === 'iam-gcp') {
          const credentials = authConfig.credentials as
            | { privateKey?: string; clientEmail?: string; private_key?: string; client_email?: string }
            | undefined
          const privateKey = credentials?.privateKey ?? credentials?.private_key
          const clientEmail = credentials?.clientEmail ?? credentials?.client_email
          if (privateKey && clientEmail) {
            return await vertexAIService.getAccessToken({
              projectId: authConfig.project,
              serviceAccount: { privateKey, clientEmail }
            })
          }
        }
      } catch (err) {
        logger.warn('Failed to get VertexAI access token, falling back to rotated apiKey:', err as Error)
      }
    }
    return providerService.getRotatedApiKey(provider.id)
  }

  /**
   * Check for OpenClaw updates by comparing the installed version with the latest GitHub release.
   */
  public async checkUpdate(): Promise<{
    hasUpdate: boolean
    currentVersion: string | null
    latestVersion: string | null
    message?: string
  }> {
    try {
      const openclawPath = await this.findOpenClawBinary()
      if (!openclawPath) {
        return { hasUpdate: false, currentVersion: null, latestVersion: null, message: 'OpenClaw binary not found' }
      }

      const shellEnv = await getShellEnv()

      // Get current version via `openclaw --version`
      const versionResult = await this.execOpenClawCommandWithResult(openclawPath, ['--version'], shellEnv, 10000)
      const currentVersion = parseCurrentVersion(versionResult.stdout)

      // Check for updates via `openclaw update status`
      const { code, stdout, stderr } = await this.execOpenClawCommandWithResult(
        openclawPath,
        ['update', 'status'],
        shellEnv,
        15000
      )

      if (code !== 0) {
        const errMsg = stderr.trim() || `Command exited with code ${code}`
        return { hasUpdate: false, currentVersion, latestVersion: null, message: errMsg }
      }

      const latestVersion = parseUpdateStatus(stdout)
      if (latestVersion) {
        return { hasUpdate: true, currentVersion, latestVersion }
      }

      // No update available
      return { hasUpdate: false, currentVersion, latestVersion: currentVersion }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('Failed to check for updates:', error as Error)
      return { hasUpdate: false, currentVersion: null, latestVersion: null, message: errorMessage }
    }
  }

  /**
   * Perform OpenClaw update by running `openclaw update`.
   */
  public async performUpdate(): Promise<OperationResult> {
    try {
      const openclawPath = await this.findOpenClawBinary()
      if (!openclawPath) {
        return { success: false, message: 'OpenClaw binary not found' }
      }

      // Stop gateway before updating
      if (this.gatewayStatus === 'running') {
        await this.stopGateway()
      }

      this.sendInstallProgress('Running openclaw update...')
      const shellEnv = await getShellEnv()
      const { code, stdout, stderr } = await this.execOpenClawCommandWithResult(
        openclawPath,
        ['update'],
        shellEnv,
        60000
      )

      if (code !== 0) {
        const errMsg = stderr.trim() || `Update failed with code ${code}`
        logger.error('OpenClaw update failed:', { error: errMsg })
        this.sendInstallProgress(errMsg, 'error')
        return { success: false, message: errMsg }
      }

      logger.info('OpenClaw updated successfully', { output: stdout.trim() })
      this.sendInstallProgress('OpenClaw updated successfully!')
      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('Failed to update OpenClaw:', error as Error)
      this.sendInstallProgress(errorMessage, 'error')
      return { success: false, message: errorMessage }
    }
  }

  /**
   * Get connected channel status
   */
  public async getChannelStatus(): Promise<ChannelInfo[]> {
    try {
      const response = await fetch(`http://127.0.0.1:${this.gatewayPort}/api/channels`, {
        signal: AbortSignal.timeout(5000)
      })
      if (response.ok) {
        const data = await response.json()
        return data.channels || []
      }
    } catch (error) {
      logger.debug('Failed to get channel status:', error as Error)
    }

    return []
  }

  /**
   * Like checkGatewayHealth but also returns error message when unhealthy.
   * Uses HTTP request for faster health checks.
   * Expected response: {"ok":true,"status":"live"}
   */
  private async checkGatewayHealthWithError(): Promise<{ status: 'healthy' | 'unhealthy'; error?: string }> {
    try {
      const response = await fetch(`http://127.0.0.1:${this.gatewayPort}/health`, {
        signal: AbortSignal.timeout(3000)
      })
      if (response.ok) {
        const data = (await response.json()) as { ok?: boolean; status?: string }
        if (data.ok && data.status === 'live') {
          return { status: 'healthy' }
        }
        return { status: 'unhealthy', error: `Gateway not live: ${JSON.stringify(data)}` }
      }
      return { status: 'unhealthy', error: `HTTP ${response.status}: ${response.statusText}` }
    } catch (error) {
      return { status: 'unhealthy', error: error instanceof Error ? error.message : String(error) }
    }
  }

  /**
   * Determine the API type based on model and provider
   * This supports mixed providers (cherryin, aihubmix, new-api, etc.) that have both OpenAI and Anthropic endpoints
   *
   * Priority order:
   * 1. Preset provider id is in the "always Anthropic" set (anthropic, vertex-anthropic)
   * 2. Model declares anthropic-messages in its supported endpoints
   * 3. Provider has an anthropic-messages endpoint config (custom providers exposing it)
   * 4. Preset provider id is openai-response
   * 5. Default to OpenAI chat completions
   */
  private determineApiType(provider: Provider, model: Model): string {
    if (provider.presetProviderId && ANTHROPIC_ONLY_PRESETS.has(provider.presetProviderId)) {
      return OPENCLAW_API_TYPES.ANTHROPIC
    }
    if (modelSupportsAnthropic(model)) {
      return OPENCLAW_API_TYPES.ANTHROPIC
    }
    if (provider.endpointConfigs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]?.baseUrl) {
      return OPENCLAW_API_TYPES.ANTHROPIC
    }
    if (provider.presetProviderId === OPENAI_RESPONSES_PRESET) {
      return OPENCLAW_API_TYPES.OPENAI_RESPOSNE
    }
    return OPENCLAW_API_TYPES.OPENAI
  }
}
