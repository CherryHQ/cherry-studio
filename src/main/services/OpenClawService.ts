import crypto from 'node:crypto'
import fs from 'node:fs'
import { Socket } from 'node:net'
import os from 'node:os'
import path from 'node:path'

import { exec } from '@expo/sudo-prompt'
import { loggerService } from '@logger'
import { isLinux, isMac, isWin } from '@main/constant'
import { isUserInChina } from '@main/utils/ipService'
import { findCommandInShellEnv, findExecutable, findGit } from '@main/utils/process'
import getShellEnv, { refreshShellEnvCache } from '@main/utils/shell-env'
import { IpcChannel } from '@shared/IpcChannel'
import { hasAPIVersion, withoutTrailingSlash } from '@shared/utils'
import type { Model, Provider, ProviderType, VertexProvider } from '@types'
import { type ChildProcess, spawn } from 'child_process'

import VertexAIService from './VertexAIService'
import { windowService } from './WindowService'

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
  private gatewayProcess: ChildProcess | null = null
  private gatewayStatus: GatewayStatus = 'stopped'
  private gatewayPort: number = DEFAULT_GATEWAY_PORT
  private gatewayAuthToken: string = ''

  constructor() {
    this.checkInstalled = this.checkInstalled.bind(this)
    this.checkNpmAvailable = this.checkNpmAvailable.bind(this)
    this.getNodeDownloadUrl = this.getNodeDownloadUrl.bind(this)
    this.install = this.install.bind(this)
    this.uninstall = this.uninstall.bind(this)
    this.startGateway = this.startGateway.bind(this)
    this.stopGateway = this.stopGateway.bind(this)
    this.restartGateway = this.restartGateway.bind(this)
    this.getStatus = this.getStatus.bind(this)
    this.checkHealth = this.checkHealth.bind(this)
    this.getDashboardUrl = this.getDashboardUrl.bind(this)
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
   * Check if npm is available in the user's shell environment
   * Refreshes shell env cache to detect newly installed Node.js
   */
  public async checkNpmAvailable(): Promise<{ available: boolean; path: string | null }> {
    // Refresh cache to detect newly installed Node.js without app restart
    refreshShellEnvCache()
    const shellEnv = await getShellEnv()

    // Log PATH for debugging npm detection issues
    const envPath = shellEnv.PATH || shellEnv.Path || ''
    logger.debug(`Checking npm availability with PATH: ${envPath}`)

    let npmPath: string | null = null

    if (isWin) {
      // On Windows, npm is a .cmd file, use findExecutable with .cmd extension
      // Note: findExecutable is synchronous (uses execFileSync) which is acceptable here
      // since we're already in an async context and Windows file ops are fast
      npmPath = findExecutable('npm', {
        extensions: ['.cmd', '.exe'],
        commonPaths: [
          path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'npm.cmd'),
          path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'nodejs', 'npm.cmd'),
          path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'npm.cmd')
        ]
      })
    } else {
      npmPath = await findCommandInShellEnv('npm', shellEnv)
    }

    logger.debug(`npm check result: ${npmPath ? `found at ${npmPath}` : 'not found'}`)

    return {
      available: npmPath !== null,
      path: npmPath
    }
  }

  /**
   * Get Node.js download URL based on current OS and architecture
   */
  public getNodeDownloadUrl(): string {
    const version = 'v22.13.1'
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64'

    if (isWin) {
      return `https://nodejs.org/dist/${version}/node-${version}-${arch}.msi`
    } else if (isMac) {
      // macOS: .pkg installer (universal)
      return `https://nodejs.org/dist/${version}/node-${version}.pkg`
    } else if (isLinux) {
      return `https://nodejs.org/dist/${version}/node-${version}-linux-${arch}.tar.xz`
    }
    // Fallback to official download page
    return 'https://nodejs.org/en/download'
  }

  /**
   * Send install progress to renderer
   */
  private sendInstallProgress(message: string, type: 'info' | 'warn' | 'error' = 'info') {
    const win = windowService.getMainWindow()
    win?.webContents.send(IpcChannel.OpenClaw_InstallProgress, { message, type })
  }

  /**
   * Install OpenClaw using npm with China mirror acceleration
   * For users in China, install @qingchencloud/openclaw-zh package instead
   */
  public async install(): Promise<{ success: boolean; message: string }> {
    const inChina = await isUserInChina()

    // For China users, install the Chinese-specific package with Chinese npm mirror
    // For other users, install the standard openclaw package
    const packageName = inChina ? '@qingchencloud/openclaw-zh@latest' : 'openclaw@latest'
    const registryArg = inChina ? `--registry=${NPM_MIRROR_CN}` : ''

    // Find npm path for use in sudo command (sudo runs in clean environment without user PATH)
    const npmCheck = await this.checkNpmAvailable()
    const npmPath = npmCheck.path || 'npm'
    const npmDir = path.dirname(npmPath)
    const npmCommand = `npm install -g ${packageName} ${registryArg}`.trim()
    const npmCommandWithPath = `PATH=${npmDir}:$PATH ${npmPath} install -g ${packageName} ${registryArg}`.trim()

    logger.info(`Installing OpenClaw with command: ${npmCommand}`)
    this.sendInstallProgress(`Running: ${npmCommand}`)

    // Use shell environment to find npm (handles GUI launch where process.env.PATH is limited)
    const shellEnv = await getShellEnv()

    // Try to find git and ensure it's in PATH for npm (some packages require git during install)
    // The frontend already gates on git availability with a localized UI; this is best-effort PATH augmentation
    const gitPath = isWin ? findGit() : await findCommandInShellEnv('git', shellEnv)
    if (gitPath) {
      const gitDir = path.dirname(gitPath)
      const pathKey = isWin ? (shellEnv.Path !== undefined ? 'Path' : 'PATH') : 'PATH'
      const currentPath = shellEnv[pathKey] || ''
      if (!currentPath.split(path.delimiter).includes(gitDir)) {
        shellEnv[pathKey] = `${gitDir}${path.delimiter}${currentPath}`
        logger.info(`Added git directory to PATH: ${gitDir}`)
      }
    } else {
      logger.warn('Git not found in environment, npm install may fail if packages require git')
    }

    return new Promise((resolve) => {
      try {
        let installProcess: ChildProcess

        if (isWin) {
          installProcess = spawn('cmd.exe', ['/c', npmCommand], {
            stdio: 'pipe',
            env: shellEnv
          })
        } else {
          installProcess = spawn('/bin/bash', ['-c', npmCommand], {
            stdio: 'pipe',
            env: shellEnv
          })
        }

        let stderr = ''

        installProcess.stdout?.on('data', (data) => {
          const msg = data.toString().trim()
          if (msg) {
            logger.info('OpenClaw install stdout:', msg)
            this.sendInstallProgress(msg)
          }
        })

        installProcess.stderr?.on('data', (data) => {
          const msg = data.toString().trim()
          stderr += data.toString()
          if (msg) {
            // npm warnings are not fatal errors
            const isWarning = msg.includes('npm warn') || msg.includes('ExperimentalWarning')
            logger.warn('OpenClaw install stderr:', msg)
            this.sendInstallProgress(msg, isWarning ? 'warn' : 'info')
          }
        })

        installProcess.on('error', (error) => {
          logger.error('OpenClaw install error:', error)
          this.sendInstallProgress(error.message, 'error')
          resolve({ success: false, message: error.message })
        })

        installProcess.on('exit', (code) => {
          if (code === 0) {
            logger.info('OpenClaw installed successfully')
            this.sendInstallProgress('OpenClaw installed successfully!')
            resolve({ success: true, message: 'OpenClaw installed successfully' })
          } else {
            logger.error(`OpenClaw install failed with code ${code}`)

            // Detect EACCES permission error and retry with sudo
            if (stderr.includes('EACCES') || stderr.includes('permission denied')) {
              logger.info('Permission denied, retrying with sudo-prompt...')
              this.sendInstallProgress('Permission denied. Requesting administrator access...')

              // Use full npm path since sudo runs in clean environment without user PATH
              exec(npmCommandWithPath, { name: 'Cherry Studio' }, (error, stdout) => {
                if (error) {
                  logger.error('Sudo install failed:', error)
                  this.sendInstallProgress(`Installation failed: ${error.message}`, 'error')
                  resolve({ success: false, message: error.message })
                } else {
                  logger.info('OpenClaw installed successfully with sudo')
                  if (stdout) {
                    this.sendInstallProgress(stdout.toString())
                  }
                  this.sendInstallProgress('OpenClaw installed successfully!')
                  resolve({ success: true, message: 'OpenClaw installed successfully' })
                }
              })
            } else {
              this.sendInstallProgress(`Installation failed with exit code ${code}`, 'error')
              resolve({
                success: false,
                message: stderr || `Installation failed with exit code ${code}`
              })
            }
          }
        })
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        logger.error('Failed to start OpenClaw installation:', error as Error)
        this.sendInstallProgress(errorMessage, 'error')
        resolve({ success: false, message: errorMessage })
      }
    })
  }

  /**
   * Uninstall OpenClaw using npm
   * Uninstalls both the standard and Chinese packages to ensure clean removal
   */
  public async uninstall(): Promise<{ success: boolean; message: string }> {
    // First stop the gateway if running
    if (this.gatewayStatus === 'running') {
      await this.stopGateway()
    }

    // Find npm path for use in sudo command (sudo runs in clean environment without user PATH)
    const npmCheck = await this.checkNpmAvailable()
    const npmPath = npmCheck.path || 'npm'
    const npmDir = path.dirname(npmPath)

    // Uninstall both packages to handle both standard and Chinese editions
    const npmCommand = 'npm uninstall -g openclaw @qingchencloud/openclaw-zh'
    // Include PATH so that npm can find node (npm is a shell script that calls node)
    const npmCommandWithPath = `PATH=${npmDir}:$PATH ${npmPath} uninstall -g openclaw @qingchencloud/openclaw-zh`
    logger.info(`Uninstalling OpenClaw with command: ${npmCommand}`)
    this.sendInstallProgress(`Running: ${npmCommand}`)

    // Use shell environment to find npm (handles GUI launch where process.env.PATH is limited)
    const shellEnv = await getShellEnv()

    return new Promise((resolve) => {
      try {
        let uninstallProcess: ChildProcess

        if (isWin) {
          uninstallProcess = spawn('cmd.exe', ['/c', npmCommand], {
            stdio: 'pipe',
            env: shellEnv
          })
        } else {
          uninstallProcess = spawn('/bin/bash', ['-c', npmCommand], {
            stdio: 'pipe',
            env: shellEnv
          })
        }

        let stderr = ''

        uninstallProcess.stdout?.on('data', (data) => {
          const msg = data.toString().trim()
          if (msg) {
            logger.info('OpenClaw uninstall stdout:', msg)
            this.sendInstallProgress(msg)
          }
        })

        uninstallProcess.stderr?.on('data', (data) => {
          const msg = data.toString().trim()
          stderr += data.toString()
          if (msg) {
            logger.warn('OpenClaw uninstall stderr:', msg)
            this.sendInstallProgress(msg, 'warn')
          }
        })

        uninstallProcess.on('error', (error) => {
          logger.error('OpenClaw uninstall error:', error)
          this.sendInstallProgress(error.message, 'error')
          resolve({ success: false, message: error.message })
        })

        uninstallProcess.on('exit', (code) => {
          if (code === 0) {
            logger.info('OpenClaw uninstalled successfully')
            this.sendInstallProgress('OpenClaw uninstalled successfully!')
            resolve({ success: true, message: 'OpenClaw uninstalled successfully' })
          } else {
            logger.error(`OpenClaw uninstall failed with code ${code}`)

            // Detect EACCES permission error and retry with sudo
            if (stderr.includes('EACCES') || stderr.includes('permission denied')) {
              logger.info('Permission denied, retrying uninstall with sudo-prompt...')
              this.sendInstallProgress('Permission denied. Requesting administrator access...')

              // Use full npm path since sudo runs in clean environment without user PATH
              exec(npmCommandWithPath, { name: 'Cherry Studio' }, (error, stdout) => {
                if (error) {
                  logger.error('Sudo uninstall failed:', error)
                  this.sendInstallProgress(`Uninstallation failed: ${error.message}`, 'error')
                  resolve({ success: false, message: error.message })
                } else {
                  logger.info('OpenClaw uninstalled successfully with sudo')
                  if (stdout) {
                    this.sendInstallProgress(stdout.toString())
                  }
                  this.sendInstallProgress('OpenClaw uninstalled successfully!')
                  resolve({ success: true, message: 'OpenClaw uninstalled successfully' })
                }
              })
            } else {
              this.sendInstallProgress(`Uninstallation failed with exit code ${code}`, 'error')
              resolve({
                success: false,
                message: stderr || `Uninstallation failed with exit code ${code}`
              })
            }
          }
        })
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        logger.error('Failed to start OpenClaw uninstallation:', error as Error)
        this.sendInstallProgress(errorMessage, 'error')
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
    this.gatewayPort = port ?? DEFAULT_GATEWAY_PORT

    // Prevent concurrent startup calls
    if (this.gatewayStatus === 'starting') {
      return { success: false, message: 'Gateway is already starting' }
    }

    const shellEnv = await getShellEnv()
    const openclawPath = await this.findOpenClawBinary()
    if (!openclawPath) {
      return {
        success: false,
        message: 'OpenClaw binary not found. Please install OpenClaw first.'
      }
    }

    // Check if gateway is already running in the system (including external processes)
    const alreadyRunning = await this.checkGatewayStatus(openclawPath, shellEnv)
    if (alreadyRunning) {
      // Reuse existing gateway instead of trying to restart
      this.gatewayStatus = 'running'
      logger.info(`Reusing existing gateway on port ${this.gatewayPort}`)
      return { success: true, message: 'Gateway is already running' }
    }

    // No gateway running, start a new one
    this.gatewayStatus = 'starting'

    try {
      await this.spawnAndWaitForGateway(openclawPath, shellEnv)
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
   * Spawn gateway process and wait for it to become ready
   * Monitors process exit and stderr for early failure detection
   */
  private async spawnAndWaitForGateway(openclawPath: string, shellEnv: Record<string, string>): Promise<void> {
    // Track startup errors from stderr and process exit
    let startupError: string | null = null
    let processExited = false

    logger.info(`Spawning gateway process: ${openclawPath} gateway --port ${this.gatewayPort}`)
    this.gatewayProcess = this.spawnOpenClaw(openclawPath, ['gateway', '--port', String(this.gatewayPort)], shellEnv)
    logger.info(`Gateway process spawned with pid: ${this.gatewayProcess.pid}`)

    // Monitor stderr for error messages
    this.gatewayProcess.stderr?.on('data', (data) => {
      const msg = data.toString()
      logger.warn('Gateway stderr:', msg)

      // Extract specific error messages for better user feedback
      if (msg.includes('already running')) {
        startupError = 'Gateway already running (port conflict)'
      } else if (msg.includes('already in use')) {
        startupError = `Port ${this.gatewayPort} is already in use`
      }
    })

    this.gatewayProcess.stdout?.on('data', (data) => {
      logger.info('Gateway stdout:', data.toString())
    })

    // Monitor process exit during startup
    this.gatewayProcess.on('exit', (code) => {
      logger.info(`Gateway process exited with code ${code}`)
      processExited = true
      if (code !== 0 && !startupError) {
        startupError = `Process exited with code ${code}`
      }
      this.gatewayProcess = null
    })

    this.gatewayProcess.on('error', (err) => {
      logger.error('Gateway process error:', err)
      processExited = true
      startupError = err.message
    })

    // Wait for gateway to become ready (max 30 seconds)
    const maxWaitMs = 30000
    const pollIntervalMs = 1000
    const startTime = Date.now()
    let pollCount = 0

    while (Date.now() - startTime < maxWaitMs) {
      // Fast fail if process has already exited
      if (processExited) {
        throw new Error(startupError || 'Gateway process exited unexpectedly')
      }

      await new Promise((r) => setTimeout(r, pollIntervalMs))
      pollCount++

      logger.debug(`Polling gateway status (attempt ${pollCount})...`)
      const isRunning = await this.checkGatewayStatus(openclawPath, shellEnv)
      if (isRunning) {
        logger.info(`Gateway is running (verified via CLI after ${pollCount} polls)`)
        return
      }

      // Fallback: also check if port is open (in case CLI status check is unreliable)
      const portOpen = await this.checkPortOpen(this.gatewayPort)
      if (portOpen) {
        logger.info(`Gateway port ${this.gatewayPort} is open (verified via port check after ${pollCount} polls)`)
        return
      }
    }

    // Timeout - process may still be starting but taking too long
    throw new Error(`Gateway failed to start within ${maxWaitMs}ms (${pollCount} polls)`)
  }

  /**
   * Stop the OpenClaw Gateway
   * Handles both our process and external gateway processes
   */
  public async stopGateway(): Promise<{ success: boolean; message: string }> {
    try {
      // If we have a process reference, kill it first
      if (this.gatewayProcess) {
        await this.killProcess(this.gatewayProcess)
        this.gatewayProcess = null
      }

      // Use CLI to stop any gateway (handles external processes too)
      const openclawPath = await this.findOpenClawBinary()
      if (openclawPath) {
        const shellEnv = await getShellEnv()
        await this.runGatewayStop(openclawPath, shellEnv)

        // Verify stop was successful
        const stillRunning = await this.checkGatewayStatus(openclawPath, shellEnv)
        if (stillRunning) {
          logger.warn('Gateway still running after stop attempt')
          return {
            success: false,
            message: 'Failed to stop gateway. Try running: openclaw gateway stop'
          }
        }
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
   * Kill a child process with SIGTERM, then SIGKILL after timeout
   */
  private async killProcess(proc: ChildProcess): Promise<void> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        proc.kill('SIGKILL')
        resolve()
      }, 5000)

      proc.once('exit', () => {
        clearTimeout(timeout)
        resolve()
      })

      proc.kill('SIGTERM')
    })
  }

  /**
   * Run `openclaw gateway stop` command
   */
  private async runGatewayStop(openclawPath: string, env: Record<string, string>): Promise<void> {
    return new Promise((resolve) => {
      const proc = this.spawnOpenClaw(openclawPath, ['gateway', 'stop'], env)

      const timeout = setTimeout(() => {
        proc.kill('SIGKILL')
        resolve()
      }, 5000)

      proc.on('exit', () => {
        clearTimeout(timeout)
        // Wait for port to be released
        setTimeout(resolve, 500)
      })

      proc.on('error', () => {
        clearTimeout(timeout)
        resolve()
      })
    })
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
   * Get OpenClaw Dashboard URL (for opening in minapp)
   */
  public getDashboardUrl(): string {
    let dashboardUrl = `http://localhost:${this.gatewayPort}`
    // Include auth token in URL for dashboard authentication
    if (this.gatewayAuthToken) {
      dashboardUrl += `?token=${encodeURIComponent(this.gatewayAuthToken)}`
    }
    return dashboardUrl
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
   * On Windows, npm global packages create .cmd wrapper scripts, not .exe files
   */
  private async findOpenClawBinary(): Promise<string | null> {
    // Try PATH lookup in user's login shell environment (best for npm global installs)
    const shellEnv = await getShellEnv()
    const binaryPath = await findCommandInShellEnv('openclaw', shellEnv)
    if (binaryPath) {
      return binaryPath
    }

    // On Windows, npm global installs create .cmd files, not .exe files
    // findCommandInShellEnv only accepts .exe, so we need to search for .cmd/.bat or files without extension
    if (isWin) {
      const cmdPath = await this.findNpmGlobalCmd('openclaw', shellEnv)
      if (cmdPath) {
        return cmdPath
      }
    }

    // Check common locations as fallback
    const binaryName = isWin ? 'openclaw.exe' : 'openclaw'
    const home = os.homedir()
    const possiblePaths = isWin
      ? [
          path.join(home, 'AppData', 'Local', 'openclaw', binaryName),
          path.join(home, '.openclaw', 'bin', binaryName),
          // Also check for .cmd in npm global locations
          path.join(home, 'AppData', 'Roaming', 'npm', 'openclaw.cmd')
        ]
      : [
          path.join(home, '.openclaw', 'bin', binaryName),
          path.join(home, '.local', 'bin', binaryName),
          `/usr/local/bin/${binaryName}`,
          `/opt/homebrew/bin/${binaryName}`
        ]

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        logger.info('Found OpenClaw binary at: ' + p)
        return p
      }
    }

    return null
  }

  /**
   * Find npm global command on Windows using 'where' command
   * Accepts .cmd files (npm global wrappers) and files without extension
   * Uses shell environment to find commands in paths set by nvm, etc.
   */
  private async findNpmGlobalCmd(command: string, shellEnv: Record<string, string>): Promise<string | null> {
    return new Promise((resolve) => {
      const child = spawn('where', [command], {
        env: shellEnv,
        stdio: ['ignore', 'pipe', 'pipe']
      })

      let output = ''
      const timeoutId = setTimeout(() => {
        child.kill('SIGKILL')
        resolve(null)
      }, 5000)

      child.stdout.on('data', (data) => {
        output += data.toString()
      })

      child.on('close', (code) => {
        clearTimeout(timeoutId)
        if (code === 0 && output.trim()) {
          const paths = output.trim().split(/\r?\n/)
          // Prefer .cmd files (npm global wrappers), then accept files without .exe extension
          // Skip .exe files as they should be found by findCommandInShellEnv
          const cmdPath = paths.find((p) => p.toLowerCase().endsWith('.cmd'))
          if (cmdPath) {
            logger.info(`Found npm global command '${command}' at: ${cmdPath}`)
            resolve(cmdPath)
            return
          }
          // Accept files without extension (e.g., openclaw without .exe)
          const noExtPath = paths.find((p) => !p.toLowerCase().endsWith('.exe'))
          if (noExtPath) {
            logger.info(`Found command '${command}' (no extension) at: ${noExtPath}`)
            resolve(noExtPath)
            return
          }
        }
        resolve(null)
      })

      child.on('error', () => {
        clearTimeout(timeoutId)
        resolve(null)
      })
    })
  }

  /**
   * Spawn OpenClaw process with proper Windows handling
   * On Windows, .cmd files and npm shims (no extension) need to be executed via cmd.exe
   */
  private spawnOpenClaw(openclawPath: string, args: string[], env: Record<string, string>): ChildProcess {
    const lowerPath = openclawPath.toLowerCase()
    // On Windows, use cmd.exe for .cmd files and files without .exe extension (npm shims)
    if (isWin && !lowerPath.endsWith('.exe')) {
      return spawn('cmd.exe', ['/c', openclawPath, ...args], {
        detached: false,
        stdio: 'pipe',
        env
      })
    }
    return spawn(openclawPath, args, {
      detached: false,
      stdio: 'pipe',
      env
    })
  }

  /**
   * Check gateway status using `openclaw gateway status` command
   * Returns true if gateway is running
   */
  private async checkGatewayStatus(openclawPath: string, env: Record<string, string>): Promise<boolean> {
    return new Promise((resolve) => {
      const statusProcess = this.spawnOpenClaw(openclawPath, ['gateway', 'status'], env)

      let stdout = ''
      const timeoutId = setTimeout(() => {
        logger.debug('Gateway status check timed out after 2s')
        statusProcess.kill('SIGKILL')
        resolve(false)
      }, 2000)

      statusProcess.stdout?.on('data', (data) => {
        stdout += data.toString()
      })

      statusProcess.on('close', (code) => {
        clearTimeout(timeoutId)
        const lowerStdout = stdout.toLowerCase()
        const isRunning = code === 0 && (lowerStdout.includes('listening') || lowerStdout.includes('running'))
        logger.debug('Gateway status check result:', { code, stdout: stdout.trim(), isRunning })
        resolve(isRunning)
      })

      statusProcess.on('error', () => {
        clearTimeout(timeoutId)
        resolve(false)
      })
    })
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
