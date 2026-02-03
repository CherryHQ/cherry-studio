import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { loggerService } from '@logger'
import { isUserInChina } from '@main/utils/ipService'
import type { Model, Provider, ProviderType } from '@types'
import { type ChildProcess, spawn } from 'child_process'
import { shell } from 'electron'

const logger = loggerService.withContext('OpenClawService')
const NPM_MIRROR_CN = 'https://registry.npmmirror.com'

const OPENCLAW_CONFIG_DIR = path.join(os.homedir(), '.openclaw')
const OPENCLAW_CONFIG_PATH = path.join(OPENCLAW_CONFIG_DIR, 'openclaw.json')
const DEFAULT_GATEWAY_PORT = 18789

export type GatewayStatus = 'stopped' | 'starting' | 'running' | 'error'

export interface HealthInfo {
  status: 'healthy' | 'unhealthy'
  gatewayPort: number
  uptime?: number
  version?: string
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

// Cherry Studio ProviderType -> OpenClaw API type mapping
const API_TYPE_MAP: Partial<Record<ProviderType, string>> = {
  openai: 'openai-completions',
  'openai-response': 'openai-completions',
  anthropic: 'anthropic-messages',
  gemini: 'google-generative-ai',
  'azure-openai': 'openai-completions',
  mistral: 'openai-completions',
  ollama: 'openai-completions',
  'new-api': 'openai-completions',
  gateway: 'openai-completions'
}

class OpenClawService {
  private gatewayProcess: ChildProcess | null = null
  private gatewayStatus: GatewayStatus = 'stopped'
  private gatewayPort: number = DEFAULT_GATEWAY_PORT
  private gatewayAuthToken: string = ''

  constructor() {
    this.checkInstalled = this.checkInstalled.bind(this)
    this.install = this.install.bind(this)
    this.startGateway = this.startGateway.bind(this)
    this.stopGateway = this.stopGateway.bind(this)
    this.restartGateway = this.restartGateway.bind(this)
    this.getStatus = this.getStatus.bind(this)
    this.checkHealth = this.checkHealth.bind(this)
    this.openDashboard = this.openDashboard.bind(this)
    this.syncProviderConfig = this.syncProviderConfig.bind(this)
    this.getChannelStatus = this.getChannelStatus.bind(this)
  }

  /**
   * Check if OpenClaw is installed
   */
  public async checkInstalled(): Promise<{ installed: boolean; path: string | null }> {
    const binaryPath = await this.findOpenClawBinary()
    return {
      installed: binaryPath !== null,
      path: binaryPath
    }
  }

  /**
   * Install OpenClaw using npm with China mirror acceleration
   */
  public async install(): Promise<{ success: boolean; message: string }> {
    const isWindows = process.platform === 'win32'
    const inChina = await isUserInChina()

    // Build npm install command with registry option for China users
    const registryArg = inChina ? `--registry=${NPM_MIRROR_CN}` : ''
    const npmCommand = `npm install -g openclaw@latest ${registryArg}`.trim()

    logger.info(`Installing OpenClaw with command: ${npmCommand}`)
    logger.info(`User in China: ${inChina}`)

    return new Promise((resolve) => {
      try {
        let installProcess: ChildProcess

        if (isWindows) {
          // Windows: Use cmd to run npm
          installProcess = spawn('cmd.exe', ['/c', npmCommand], {
            stdio: 'pipe',
            env: { ...process.env }
          })
        } else {
          // macOS/Linux: Use bash to run npm
          installProcess = spawn('/bin/bash', ['-c', npmCommand], {
            stdio: 'pipe',
            env: { ...process.env }
          })
        }

        let stderr = ''

        installProcess.stdout?.on('data', (data) => {
          logger.info('OpenClaw install stdout:', data.toString())
        })

        installProcess.stderr?.on('data', (data) => {
          stderr += data.toString()
          logger.warn('OpenClaw install stderr:', data.toString())
        })

        installProcess.on('error', (error) => {
          logger.error('OpenClaw install error:', error)
          resolve({ success: false, message: error.message })
        })

        installProcess.on('exit', (code) => {
          if (code === 0) {
            logger.info('OpenClaw installed successfully')
            resolve({ success: true, message: 'OpenClaw installed successfully' })
          } else {
            logger.error(`OpenClaw install failed with code ${code}`)
            resolve({
              success: false,
              message: stderr || `Installation failed with exit code ${code}`
            })
          }
        })
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        logger.error('Failed to start OpenClaw installation:', error as Error)
        resolve({ success: false, message: errorMessage })
      }
    })
  }

  /**
   * Start the OpenClaw Gateway
   */
  public async startGateway(
    _: Electron.IpcMainInvokeEvent,
    port?: number
  ): Promise<{ success: boolean; message: string }> {
    if (this.gatewayStatus === 'running') {
      return { success: true, message: 'Gateway is already running' }
    }

    this.gatewayPort = port ?? DEFAULT_GATEWAY_PORT
    this.gatewayStatus = 'starting'

    try {
      // Check if openclaw binary exists in PATH
      const openclawPath = await this.findOpenClawBinary()
      if (!openclawPath) {
        this.gatewayStatus = 'error'
        return {
          success: false,
          message: 'OpenClaw binary not found. Please install OpenClaw first.'
        }
      }

      // Stop any existing gateway first (from previous sessions that didn't clean up)
      await this.stopExistingGateway(openclawPath)

      // Start the gateway process
      this.gatewayProcess = spawn(openclawPath, ['gateway', '--port', String(this.gatewayPort)], {
        detached: false,
        stdio: 'pipe',
        env: { ...process.env }
      })

      this.gatewayProcess.stdout?.on('data', (data) => {
        logger.info('Gateway stdout:', data.toString())
      })

      this.gatewayProcess.stderr?.on('data', (data) => {
        logger.warn('Gateway stderr:', data.toString())
      })

      this.gatewayProcess.on('error', (error) => {
        logger.error('Gateway process error:', error)
        this.gatewayStatus = 'error'
      })

      this.gatewayProcess.on('exit', (code) => {
        logger.info(`Gateway process exited with code ${code}`)
        this.gatewayStatus = 'stopped'
        this.gatewayProcess = null
      })

      // Wait a bit and check if gateway started successfully
      await this.waitForGateway()

      this.gatewayStatus = 'running'
      logger.info(`Gateway started on port ${this.gatewayPort}`)
      return { success: true, message: `Gateway started on port ${this.gatewayPort}` }
    } catch (error) {
      this.gatewayStatus = 'error'
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('Failed to start gateway:', error as Error)
      return { success: false, message: errorMessage }
    }
  }

  /**
   * Stop the OpenClaw Gateway
   */
  public async stopGateway(): Promise<{ success: boolean; message: string }> {
    try {
      // If we have a process reference, kill it
      if (this.gatewayProcess) {
        this.gatewayProcess.kill('SIGTERM')
        this.gatewayProcess = null
      }

      // Also try CLI command to stop any gateway (in case of orphaned process)
      const openclawPath = await this.findOpenClawBinary()
      if (openclawPath) {
        await this.stopExistingGateway(openclawPath)
      }

      this.gatewayStatus = 'stopped'
      logger.info('Gateway stopped')
      return { success: true, message: 'Gateway stopped successfully' }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('Failed to stop gateway:', error as Error)
      return { success: false, message: errorMessage }
    }
  }

  /**
   * Restart the OpenClaw Gateway
   */
  public async restartGateway(event: Electron.IpcMainInvokeEvent): Promise<{ success: boolean; message: string }> {
    await this.stopGateway()
    return this.startGateway(event, this.gatewayPort)
  }

  /**
   * Get Gateway status
   */
  public getStatus(): { status: GatewayStatus; port: number } {
    return {
      status: this.gatewayStatus,
      port: this.gatewayPort
    }
  }

  /**
   * Check Gateway health by verifying WebSocket connectivity
   */
  public async checkHealth(): Promise<HealthInfo> {
    // If we know the gateway is not running, return unhealthy immediately
    if (this.gatewayStatus !== 'running' || !this.gatewayProcess) {
      return {
        status: 'unhealthy',
        gatewayPort: this.gatewayPort
      }
    }

    try {
      // Check if the WebSocket port is accepting connections
      const isAlive = await this.checkPortOpen(this.gatewayPort)
      if (isAlive) {
        return {
          status: 'healthy',
          gatewayPort: this.gatewayPort
        }
      }
    } catch (error) {
      logger.debug('Health check failed:', error as Error)
    }

    return {
      status: 'unhealthy',
      gatewayPort: this.gatewayPort
    }
  }

  /**
   * Check if a port is open and accepting connections
   */
  private async checkPortOpen(port: number): Promise<boolean> {
    const net = await import('net')
    return new Promise((resolve) => {
      const socket = new net.Socket()
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
   * Open OpenClaw Dashboard in browser
   */
  public async openDashboard(): Promise<void> {
    let dashboardUrl = `http://localhost:${this.gatewayPort}`
    // Include auth token in URL for dashboard authentication
    if (this.gatewayAuthToken) {
      dashboardUrl += `?token=${encodeURIComponent(this.gatewayAuthToken)}`
    }
    await shell.openExternal(dashboardUrl)
    logger.info('Opened OpenClaw Dashboard', { url: dashboardUrl })
  }

  /**
   * Generate a random auth token
   */
  private generateAuthToken(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    let token = ''
    for (let i = 0; i < 32; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return token
  }

  /**
   * Sync Cherry Studio Provider configuration to OpenClaw
   */
  public async syncProviderConfig(
    _: Electron.IpcMainInvokeEvent,
    provider: Provider,
    primaryModel: Model
  ): Promise<{ success: boolean; message: string }> {
    try {
      // Ensure config directory exists
      if (!fs.existsSync(OPENCLAW_CONFIG_DIR)) {
        fs.mkdirSync(OPENCLAW_CONFIG_DIR, { recursive: true })
      }

      // Read existing config or create new one
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

      // Build OpenClaw provider config
      const openclawProvider: OpenClawProviderConfig = {
        baseUrl: this.formatBaseUrl(provider.apiHost, provider.type),
        apiKey: provider.apiKey,
        api: API_TYPE_MAP[provider.type] || 'openai-completions',
        models: provider.models.map((m) => ({
          id: m.id,
          name: m.name,
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
      return { success: true, message: `Provider ${provider.name} synced to OpenClaw` }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('Failed to sync provider config:', error as Error)
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
   * Find OpenClaw binary in PATH or common locations
   */
  private async findOpenClawBinary(): Promise<string | null> {
    // Check common locations
    const possiblePaths = [
      path.join(os.homedir(), '.openclaw', 'bin', 'openclaw'),
      path.join(os.homedir(), '.local', 'bin', 'openclaw'),
      '/usr/local/bin/openclaw',
      '/opt/homebrew/bin/openclaw'
    ]

    // Add Windows paths
    if (process.platform === 'win32') {
      possiblePaths.push(
        path.join(os.homedir(), 'AppData', 'Local', 'openclaw', 'openclaw.exe'),
        path.join(os.homedir(), '.openclaw', 'bin', 'openclaw.exe')
      )
    }

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        logger.info('Found OpenClaw binary at: ' + p)
        return p
      }
    }

    // Try to find in PATH using which/where
    try {
      const { promisify } = await import('util')
      const exec = promisify((await import('child_process')).exec)
      const cmd = process.platform === 'win32' ? 'where openclaw' : 'which openclaw'
      const { stdout } = await exec(cmd)
      const binaryPath = stdout.trim().split('\n')[0]
      if (binaryPath && fs.existsSync(binaryPath)) {
        logger.info('Found OpenClaw in PATH: ' + binaryPath)
        return binaryPath
      }
    } catch {
      logger.debug('OpenClaw not found in PATH')
    }

    return null
  }

  /**
   * Stop any existing gateway from previous sessions using CLI command
   */
  private async stopExistingGateway(openclawPath: string): Promise<void> {
    return new Promise((resolve) => {
      const stopProcess = spawn(openclawPath, ['gateway', 'stop'], {
        stdio: 'pipe',
        env: { ...process.env }
      })

      stopProcess.on('exit', () => {
        // Give a moment for the port to be released
        setTimeout(resolve, 500)
      })

      stopProcess.on('error', () => {
        resolve()
      })

      // Timeout after 3 seconds
      setTimeout(resolve, 3000)
    })
  }

  /**
   * Wait for Gateway to start by checking port connectivity
   */
  private async waitForGateway(maxAttempts = 10): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500))
      const isOpen = await this.checkPortOpen(this.gatewayPort)
      if (isOpen) {
        return
      }
    }
  }

  /**
   * Format base URL for OpenClaw
   */
  private formatBaseUrl(apiHost: string, type: ProviderType): string {
    let url = apiHost.replace(/\/$/, '')
    // Add /v1 suffix for OpenAI-compatible APIs
    if (!url.endsWith('/v1') && type !== 'anthropic') {
      url += '/v1'
    }
    return url
  }
}

export const openClawService = new OpenClawService()
