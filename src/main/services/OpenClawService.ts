import crypto from 'node:crypto'
import fs from 'node:fs'
import { Socket } from 'node:net'
import os from 'node:os'
import path from 'node:path'

import { loggerService } from '@logger'
import { isWin } from '@main/constant'
import { isUserInChina } from '@main/utils/ipService'
import { crossPlatformSpawn, findExecutableInEnv, getBinaryPath, runInstallScript } from '@main/utils/process'
import getShellEnv, { refreshShellEnv } from '@main/utils/shell-env'
import type { OperationResult } from '@shared/config/types'
import { IpcChannel } from '@shared/IpcChannel'
import { hasAPIVersion, withoutTrailingSlash } from '@shared/utils'
import type { Model, Provider, ProviderType, VertexProvider } from '@types'

import { parseCurrentVersion, parseUpdateStatus } from './utils/openClawParsers'
import VertexAIService from './VertexAIService'
import { windowService } from './WindowService'

const logger = loggerService.withContext('OpenClawService')

const OPENCLAW_CONFIG_DIR = path.join(os.homedir(), '.openclaw')
const OPENCLAW_CONFIG_PATH = path.join(OPENCLAW_CONFIG_DIR, 'openclaw.json')
const OPENCLAW_LEGACY_CONFIG_PATH = path.join(OPENCLAW_CONFIG_DIR, 'openclaw.cherry.json')
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

export interface OpenClawProviderConfig {
  baseUrl: string
  apiKey: string
  api: string
  models: Array<{
    id: string
    name: string
    contextWindow?: number
  }>
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
 * Providers that always use Anthropic API format
 */
const ANTHROPIC_ONLY_PROVIDERS: ProviderType[] = ['anthropic', 'vertex-anthropic']

/**
 * Endpoint types that use Anthropic API format
 * These are values from model.endpoint_type field
 */
const ANTHROPIC_ENDPOINT_TYPES = ['anthropic']

/**
 * Check if a model should use Anthropic API based on endpoint_type
 */
function isAnthropicEndpointType(model: Model): boolean {
  const endpointType = model.endpoint_type
  return endpointType ? ANTHROPIC_ENDPOINT_TYPES.includes(endpointType) : false
}

/**
 * Type guard to check if a provider is a VertexProvider
 */
function isVertexProvider(provider: Provider): provider is VertexProvider {
  return provider.type === 'vertexai'
}

class OpenClawService {
  private gatewayStatus: GatewayStatus = 'stopped'
  private gatewayPort: number = DEFAULT_GATEWAY_PORT
  private gatewayAuthToken: string = ''

  public get gatewayUrl(): string {
    return `ws://127.0.0.1:${this.gatewayPort}/ws`
  }

  constructor() {
    this.checkInstalled = this.checkInstalled.bind(this)
    this.install = this.install.bind(this)
    this.uninstall = this.uninstall.bind(this)
    this.startGateway = this.startGateway.bind(this)
    this.stopGateway = this.stopGateway.bind(this)
    this.getStatus = this.getStatus.bind(this)
    this.checkHealth = this.checkHealth.bind(this)
    this.getDashboardUrl = this.getDashboardUrl.bind(this)
    this.syncProviderConfig = this.syncProviderConfig.bind(this)
    this.getChannelStatus = this.getChannelStatus.bind(this)
    this.checkUpdate = this.checkUpdate.bind(this)
    this.performUpdate = this.performUpdate.bind(this)
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
    const win = windowService.getMainWindow()
    win?.webContents.send(IpcChannel.OpenClaw_InstallProgress, { message, type })
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
  public async startGateway(_: Electron.IpcMainInvokeEvent, port?: number): Promise<OperationResult> {
    this.gatewayPort = port ?? DEFAULT_GATEWAY_PORT

    // Prevent concurrent startup calls
    if (this.gatewayStatus === 'starting') {
      return { success: false, message: 'Gateway is already starting' }
    }

    // Check if the port is already in use
    const isPortOpen = await this.checkPortOpen(this.gatewayPort)
    if (isPortOpen) {
      // Check if this is our gateway already running on this port
      const shellEnv = await refreshShellEnv()
      const openclawPath = await this.findOpenClawBinary()
      if (openclawPath) {
        const alreadyRunning = await this.checkGatewayStatus(openclawPath, shellEnv)
        if (alreadyRunning) {
          this.gatewayStatus = 'running'
          logger.info(`Reusing existing gateway on port ${this.gatewayPort}`)
          return { success: true }
        }
      }
      return {
        success: false,
        message: `Port ${this.gatewayPort} is already in use by another application. Please choose a different port.`
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
   * Start gateway via `openclaw gateway --force` and wait for it to become ready.
   * Spawns the gateway as a detached process so its lifecycle is independent.
   * Uses `openclaw gateway stop` to stop it later.
   */
  private async startAndWaitForGateway(openclawPath: string, shellEnv: Record<string, string>): Promise<void> {
    const args = ['gateway', '--force']

    logger.info(`Starting gateway: ${openclawPath} ${args.join(' ')}`)

    // Spawn detached — the gateway runs independently, we poll for readiness.
    // Use 'pipe' for stderr so we can capture error details on early exit.
    const proc = crossPlatformSpawn(openclawPath, args, {
      env: shellEnv,
      detached: true,
      stdio: ['ignore', 'ignore', 'pipe']
    })
    proc.unref()

    // Collect early exit errors (e.g. binary crash on startup)
    let earlyExitError = ''
    let stderrOutput = ''
    proc.stderr?.on('data', (data) => {
      stderrOutput += data.toString()
    })
    proc.on('error', (err) => {
      earlyExitError = err.message
    })
    proc.on('exit', (code) => {
      if (code !== 0) {
        // Extract the most useful line from stderr for the error message
        const detail = stderrOutput.trim().split('\n').filter(Boolean).slice(0, 3).join('\n')
        earlyExitError = detail || `gateway exited with code ${code}`
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
      const { status, error: healthError } = await this.probeGatewayHealthWithError(openclawPath, shellEnv)
      if (status === 'healthy') {
        logger.info(`Gateway is healthy (verified after ${pollCount} polls)`)
        return
      }
      if (healthError) lastError = healthError
    }

    const detail = lastError ? `\n${lastError}` : ''
    throw new Error(`Gateway failed to start within ${maxWaitMs}ms (${pollCount} polls)${detail}`)
  }

  /**
   * Stop the OpenClaw Gateway
   */
  public async stopGateway(): Promise<OperationResult> {
    try {
      const openclawPath = await this.findOpenClawBinary()
      if (!openclawPath) {
        this.gatewayStatus = 'error'
        return { success: false, message: 'OpenClaw binary not found' }
      }

      const shellEnv = await getShellEnv()
      await this.runGatewayStop(openclawPath, shellEnv)

      const stillRunning = await this.waitForGatewayStop(openclawPath, shellEnv)
      if (stillRunning) {
        this.gatewayStatus = 'error'
        return { success: false, message: 'Failed to stop gateway. Try running: openclaw gateway stop' }
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
   * Wait for gateway to actually stop, with retries.
   * Returns true if gateway is still running after all retries.
   */
  private async waitForGatewayStop(
    openclawPath: string,
    env: Record<string, string>,
    maxRetries = 3,
    intervalMs = 1000
  ): Promise<boolean> {
    for (let i = 0; i < maxRetries; i++) {
      const stillRunning = await this.checkGatewayStatus(openclawPath, env)
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

  private async runGatewayStop(openclawPath: string, env: Record<string, string>): Promise<void> {
    await this.execOpenClawCommandWithResult(openclawPath, ['gateway', 'stop'], env)
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

    const { status } = await this.probeGatewayHealth()
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
    const healthInfo = await this.probeGatewayHealth()
    if (healthInfo.status === 'unhealthy') {
      logger.warn(`Gateway health check failed, marking as stopped`)
      this.gatewayStatus = 'stopped'
    }
    return healthInfo
  }

  /**
   * Probe gateway health by running `openclaw gateway health`.
   * Does NOT check gatewayStatus — callers that need to detect
   * externally-started gateways should call this directly.
   */
  private async probeGatewayHealth(): Promise<HealthInfo> {
    try {
      const openclawPath = await this.findOpenClawBinary()
      if (!openclawPath) {
        return { status: 'unhealthy', gatewayPort: this.gatewayPort }
      }
      const shellEnv = await getShellEnv()
      const { code } = await this.execOpenClawCommandWithResult(openclawPath, ['gateway', 'health'], shellEnv)
      if (code === 0) {
        return { status: 'healthy', gatewayPort: this.gatewayPort }
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
        resolve(true)
      })

      socket.on('timeout', () => {
        socket.destroy()
        resolve(false)
      })

      socket.on('error', () => {
        socket.destroy()
        resolve(false)
      })

      socket.connect(port, 'localhost')
    })
  }

  /**
   * Get OpenClaw Dashboard URL (for opening in minapp).
   * The Control UI uses ?token= to auto-authenticate the WebSocket connection.
   */
  public getDashboardUrl(): string {
    // Ensure we have the token (may have been lost after app restart)
    if (!this.gatewayAuthToken) {
      this.loadAuthTokenFromConfig()
    }
    let url = `http://127.0.0.1:${this.gatewayPort}`
    if (this.gatewayAuthToken) {
      url += `#token=${encodeURIComponent(this.gatewayAuthToken)}`
    }
    return url
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
    } catch {
      logger.debug('Failed to load auth token from config file')
    }
  }

  /**
   * Generate a cryptographically secure random auth token
   */
  private generateAuthToken(): string {
    return crypto.randomBytes(24).toString('base64url')
  }

  /**
   * Sync Cherry Studio Provider configuration to OpenClaw
   */
  public async syncProviderConfig(
    _: Electron.IpcMainInvokeEvent,
    provider: Provider,
    primaryModel: Model
  ): Promise<OperationResult> {
    try {
      // Ensure config directory exists
      if (!fs.existsSync(OPENCLAW_CONFIG_DIR)) {
        fs.mkdirSync(OPENCLAW_CONFIG_DIR, { recursive: true })
      }

      // Migrate legacy openclaw.cherry.json → openclaw.json
      if (fs.existsSync(OPENCLAW_LEGACY_CONFIG_PATH)) {
        if (!fs.existsSync(OPENCLAW_CONFIG_PATH)) {
          fs.renameSync(OPENCLAW_LEGACY_CONFIG_PATH, OPENCLAW_CONFIG_PATH)
          logger.info('Migrated openclaw.cherry.json → openclaw.json')
        } else {
          fs.unlinkSync(OPENCLAW_LEGACY_CONFIG_PATH)
          logger.info('Removed legacy openclaw.cherry.json (openclaw.json already exists)')
        }
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

      // Build provider key
      const providerKey = `cherry-${provider.id}`

      // Determine the API type based on model, not provider type
      // Mixed providers (cherryin, aihubmix, etc.) can have both OpenAI and Anthropic endpoints
      const apiType = this.determineApiType(provider, primaryModel)
      const baseUrl = this.getBaseUrlForApiType(provider, apiType)

      // Get API key - for vertexai, get access token from VertexAIService
      // If multiple API keys are configured (comma-separated), use the first one
      // Some providers like Ollama and LM Studio don't require API keys
      let apiKey = provider.apiKey ? provider.apiKey.split(',')[0].trim() : ''
      if (isVertexProvider(provider)) {
        try {
          const vertexService = VertexAIService.getInstance()
          apiKey = await vertexService.getAccessToken({
            projectId: provider.project,
            serviceAccount: {
              privateKey: provider.googleCredentials.privateKey,
              clientEmail: provider.googleCredentials.clientEmail
            }
          })
        } catch (err) {
          logger.warn('Failed to get VertexAI access token, using provider apiKey:', err as Error)
        }
      }

      // Build OpenClaw provider config
      const openclawProvider: OpenClawProviderConfig = {
        baseUrl,
        apiKey,
        api: apiType,
        models: provider.models.map((m) => ({
          id: m.id,
          name: m.name,
          // FIXME: in v2
          contextWindow: 128000
        }))
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
      config.models = config.models || { mode: 'merge', providers: {} }
      config.models.providers = config.models.providers || {}
      config.models.providers[providerKey] = openclawProvider

      // Set primary model
      config.agents = config.agents || { defaults: {} }
      config.agents.defaults = config.agents.defaults || {}
      config.agents.defaults.model = {
        primary: `${providerKey}/${primaryModel.id}`
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
      const response = await fetch(`http://localhost:${this.gatewayPort}/api/channels`, {
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
   * Check gateway status using `openclaw gateway status` command
   * Returns true if gateway is running
   */
  private async checkGatewayStatus(openclawPath: string, env: Record<string, string>): Promise<boolean> {
    return new Promise((resolve) => {
      const statusProcess = crossPlatformSpawn(openclawPath, ['gateway', 'status'], { env })

      let stdout = ''
      let resolved = false

      const doResolve = (value: boolean) => {
        if (resolved) return
        resolved = true
        resolve(value)
      }

      const timeoutId = setTimeout(() => {
        // On timeout, check stdout accumulated so far before giving up
        const lowerStdout = stdout.toLowerCase()
        const isRunning = lowerStdout.includes('listening')
        logger.debug(`Gateway status check timed out after 10s, stdout indicates running: ${isRunning}`)
        statusProcess.kill('SIGKILL')
        doResolve(isRunning)
      }, 10_000)

      statusProcess.stdout?.on('data', (data) => {
        stdout += data.toString()
      })

      statusProcess.on('close', (code) => {
        clearTimeout(timeoutId)
        const lowerStdout = stdout.toLowerCase()
        const isRunning = (code === 0 || code === null) && lowerStdout.includes('listening')
        logger.debug('Gateway status check result:', { code, stdout: stdout.trim(), isRunning })
        doResolve(isRunning)
      })

      statusProcess.on('error', () => {
        clearTimeout(timeoutId)
        doResolve(false)
      })
    })
  }

  /**
   * Like probeGatewayHealth but also returns stderr when unhealthy.
   */
  private async probeGatewayHealthWithError(
    openclawPath: string,
    env: Record<string, string>
  ): Promise<{ status: 'healthy' | 'unhealthy'; error?: string }> {
    try {
      const { code, stderr } = await this.execOpenClawCommandWithResult(openclawPath, ['gateway', 'health'], env)
      if (code === 0) {
        return { status: 'healthy' }
      }
      return { status: 'unhealthy', error: stderr.trim() || undefined }
    } catch (error) {
      return { status: 'unhealthy', error: error instanceof Error ? error.message : String(error) }
    }
  }

  /**
   * Determine the API type based on model and provider
   * This supports mixed providers (cherryin, aihubmix, new-api, etc.) that have both OpenAI and Anthropic endpoints
   *
   * Priority order:
   * 1. Provider type (anthropic, vertex-anthropic always use Anthropic API)
   * 2. Model endpoint_type (explicit endpoint configuration)
   * 3. Provider has anthropicApiHost configured
   * 4. Default to OpenAI-compatible
   */
  private determineApiType(provider: Provider, model: Model): string {
    // 1. Check if provider type is always Anthropic
    if (ANTHROPIC_ONLY_PROVIDERS.includes(provider.type)) {
      return OPENCLAW_API_TYPES.ANTHROPIC
    }

    // 2. Check model's endpoint_type (used by new-api and other mixed providers)
    if (isAnthropicEndpointType(model)) {
      return OPENCLAW_API_TYPES.ANTHROPIC
    }

    // 3. Check if provider has anthropicApiHost configured
    if (provider.anthropicApiHost) {
      return OPENCLAW_API_TYPES.ANTHROPIC
    }

    if (provider.type === 'openai-response') {
      return OPENCLAW_API_TYPES.OPENAI_RESPOSNE
    }

    // 4. Default to OpenAI-compatible
    return OPENCLAW_API_TYPES.OPENAI
  }

  /**
   * Get the appropriate base URL for the given API type
   * For anthropic-messages, prefer anthropicApiHost if available
   * For openai-completions, use apiHost with proper formatting
   */
  private getBaseUrlForApiType(provider: Provider, apiType: string): string {
    if (apiType === OPENCLAW_API_TYPES.ANTHROPIC) {
      // For Anthropic API type, prefer anthropicApiHost if available
      const host = provider.anthropicApiHost || provider.apiHost
      return this.formatAnthropicUrl(host)
    }
    // For OpenAI-compatible API type
    return this.formatOpenAIUrl(provider)
  }

  /**
   * Format URL for OpenAI-compatible APIs
   * Provider-specific URL patterns:
   * - VertexAI: {location}-aiplatform.googleapis.com/v1beta1/projects/{project}/locations/{location}/endpoints/openapi
   * - Gemini: {host}/v1beta/openai (OpenAI-compatible endpoint)
   * - Vercel AI Gateway: {host}/v1 (stored as /v1/ai, needs conversion)
   * - Others: {host}/v1
   */
  private formatOpenAIUrl(provider: Provider): string {
    const url = withoutTrailingSlash(provider.apiHost)
    const providerType = provider.type

    // VertexAI: build OpenAI-compatible endpoint URL with project and location
    // https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/call-gemini-using-openai-library
    if (isVertexProvider(provider)) {
      const location = provider.location || 'us-central1'
      return `https://${location}-aiplatform.googleapis.com/v1beta1/projects/${provider.project}/locations/${location}/endpoints/openapi`
    }

    // Gemini: use OpenAI-compatible endpoint
    // https://ai.google.dev/gemini-api/docs/openai
    if (providerType === 'gemini' && url.includes('generativelanguage.googleapis.com')) {
      return `${url}/v1beta/openai`
    }

    // Vercel AI Gateway: convert /v1/ai to /v1
    if (providerType === 'gateway' && url.endsWith('/v1/ai')) {
      return url.replace(/\/v1\/ai$/, '/v1')
    }

    // Skip if URL already has version (e.g., /v1, /v2, /v3)
    if (hasAPIVersion(url)) {
      return url
    }

    return `${url}/v1`
  }

  /**
   * Format URL for Anthropic-compatible APIs (no version suffix needed)
   */
  private formatAnthropicUrl(apiHost: string): string {
    return withoutTrailingSlash(apiHost)
  }
}

export const openClawService = new OpenClawService()
