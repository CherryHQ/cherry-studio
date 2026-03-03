import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { exec } from '@expo/sudo-prompt'
import { loggerService } from '@logger'
import { isLinux, isMac, isWin } from '@main/constant'
import { crossPlatformSpawn, executeCommand, findExecutableInEnv } from '@main/utils/process'
import getShellEnv, { refreshShellEnv } from '@main/utils/shell-env'
import type { NodeCheckResult } from '@shared/config/types'
import type { OperationResult } from '@shared/config/types'
import { IpcChannel } from '@shared/IpcChannel'
import { hasAPIVersion, withoutTrailingSlash } from '@shared/utils'
import type { Model, Provider, ProviderType, VertexProvider } from '@types'
import semver from 'semver'

import VertexAIService from './VertexAIService'
import { windowService } from './WindowService'

const logger = loggerService.withContext('OpenClawService')

const OPENCLAW_CONFIG_DIR = path.join(os.homedir(), '.openclaw')
// Original user config (read-only, used as template for first-time setup)
const OPENCLAW_ORIGINAL_CONFIG_PATH = path.join(OPENCLAW_CONFIG_DIR, 'openclaw.json')
// Cherry Studio's isolated config (read/write) — OpenClaw reads the OPENCLAW_CONFIG_PATH env var to locate this
const OPENCLAW_CONFIG_PATH = path.join(OPENCLAW_CONFIG_DIR, 'openclaw.cherry.json')
const DEFAULT_GATEWAY_PORT = 18790

export type GatewayStatus = 'stopped' | 'starting' | 'running' | 'error'

export type { OperationResult }

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
    this.checkNodeVersion = this.checkNodeVersion.bind(this)
    this.getNodeDownloadUrl = this.getNodeDownloadUrl.bind(this)
    this.getGitDownloadUrl = this.getGitDownloadUrl.bind(this)
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
    const binaryPath = await findExecutableInEnv('openclaw')
    return { installed: binaryPath !== null, path: binaryPath }
  }

  /**
   * Check if Node.js is available and meets the minimum version requirement (22.0+).
   * Detects Node.js through the user's login shell environment (handles nvm, mise, fnm, etc.)
   *
   * Returns a discriminated union so callers can distinguish between:
   * - Node.js not installed at all
   * - Node.js installed but version too low
   * - Node.js installed and version OK
   */
  public async checkNodeVersion(): Promise<NodeCheckResult> {
    const MINIMUM_VERSION = '22.0.0'
    try {
      await refreshShellEnv()
      const nodePath = await findExecutableInEnv('node')
      if (!nodePath) {
        logger.debug('Node.js not found in environment')
        return { status: 'not_found' }
      }

      const output = await executeCommand(nodePath, ['--version'], { capture: true, timeout: 5000 })
      const version = semver.valid(semver.coerce(output.trim()))

      if (!version || semver.lt(version, MINIMUM_VERSION)) {
        logger.debug(`Node.js version too low: ${version} at ${nodePath}`)
        return { status: 'version_low', version: version ?? output.trim(), path: nodePath }
      }

      logger.debug(`Node.js version OK: ${version} at ${nodePath}`)
      return { status: 'ok', version, path: nodePath }
    } catch (error) {
      logger.warn('Failed to check Node.js version:', error as Error)
      return { status: 'not_found' }
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
   * Get Git download URL based on current OS and architecture
   */
  public getGitDownloadUrl(): string {
    const version = '2.53.0'

    if (isWin) {
      const winArch = process.arch === 'arm64' ? 'arm64' : '64-bit'
      return `https://github.com/git-for-windows/git/releases/download/v${version}.windows.1/Git-${version}-${winArch}.exe`
    } else if (isMac) {
      return 'https://git-scm.com/download/mac'
    } else if (isLinux) {
      return 'https://git-scm.com/download/linux'
    }
    return 'https://git-scm.com/downloads'
  }

  /**
   * Send install progress to renderer
   */
  private sendInstallProgress(message: string, type: 'info' | 'warn' | 'error' = 'info') {
    const win = windowService.getMainWindow()
    win?.webContents.send(IpcChannel.OpenClaw_InstallProgress, { message, type })
  }

  /**
   * Build the platform-specific command and args for the official OpenClaw install script.
   */
  private buildInstallCommand(): { command: string; args: string[] } {
    if (isWin) {
      // Set [Console]::OutputEncoding to UTF-8 inside PowerShell to avoid GBK mojibake on Chinese Windows.
      // Cannot use cmd.exe /c chcp wrapper because cmd.exe consumes quotes needed by PowerShell.
      return {
        command: 'powershell.exe',
        args: [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; & ([scriptblock]::Create((iwr -useb https://openclaw.ai/install.ps1))) -NoOnboard'
        ]
      }
    }
    return {
      command: '/bin/sh',
      args: ['-c', 'curl -fsSL https://openclaw.ai/install.sh | bash -s -- --no-onboard --no-prompt']
    }
  }

  /**
   * Install OpenClaw using the official install scripts.
   * Streams output in real-time. On macOS/Linux, retries with sudo-prompt on permission errors.
   */
  public async install(): Promise<OperationResult> {
    const { command, args } = this.buildInstallCommand()
    const shellCommand = `${command} ${args.join(' ')}`
    const spawnEnv = await getShellEnv()

    logger.info(`Installing OpenClaw with official script: ${shellCommand}`)
    this.sendInstallProgress('Running official installer...')

    return new Promise((resolve) => {
      try {
        const installProcess = crossPlatformSpawn(command, args, { env: spawnEnv })

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
            logger.warn('OpenClaw install stderr:', msg)
            this.sendInstallProgress(msg, 'warn')
          }
        })

        installProcess.on('error', (error) => {
          logger.error('OpenClaw install error:', error)
          this.sendInstallProgress(error.message, 'error')
          resolve({ success: false, message: error.message })
        })

        installProcess.on('exit', async (code) => {
          if (code === 0) {
            logger.info('OpenClaw installed successfully')
            this.sendInstallProgress('OpenClaw installed successfully!')
            await this.installGatewayService()
            resolve({ success: true })
          } else if (
            !isWin &&
            (stderr.includes('EACCES') || stderr.includes('permission denied') || stderr.includes('Permission denied'))
          ) {
            // Permission error on macOS/Linux — retry with elevated privileges
            logger.info('Permission denied, retrying with sudo-prompt...')
            this.sendInstallProgress('Permission denied. Requesting administrator access...')

            exec(shellCommand, { name: 'Cherry Studio' }, async (error, stdout) => {
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
                await this.installGatewayService()
                resolve({ success: true })
              }
            })
          } else {
            logger.error(`OpenClaw install failed with exit code ${code}`, { stderr: stderr.trim() })
            this.sendInstallProgress(`Installation failed with exit code ${code}`, 'error')
            resolve({
              success: false,
              message: stderr.trim() || `Installation failed with exit code ${code}`
            })
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
   * Register gateway as a system service (launchd/systemd) after npm install
   */
  private async installGatewayService(): Promise<void> {
    try {
      // Refresh shell env to pick up PATH changes from the official installer
      const shellEnv = await refreshShellEnv()
      const openclawPath = await findExecutableInEnv('openclaw')
      if (!openclawPath) {
        logger.warn('Cannot install gateway service: openclaw binary not found')
        return
      }

      this.sendInstallProgress('Registering gateway service...')
      const { code, stderr } = await this.execOpenClawCommandWithResult(
        openclawPath,
        ['gateway', 'install', '--port', String(this.gatewayPort)],
        shellEnv
      )

      if (code === 0) {
        logger.info('Gateway service registered successfully')
        this.sendInstallProgress('Gateway service registered')
      } else {
        logger.warn('Gateway service install returned non-zero:', { code, stderr: stderr.trim() })
      }
    } catch (error) {
      logger.warn('Failed to register gateway service:', error as Error)
    }
  }

  /**
   * Ensure gateway service is registered (idempotent).
   * Handles upgrade from older versions that only did `npm install -g` without `gateway install`.
   */
  private async ensureGatewayServiceInstalled(openclawPath: string, shellEnv: Record<string, string>): Promise<void> {
    const { stdout } = await this.execOpenClawCommandWithResult(openclawPath, ['gateway', 'status'], shellEnv)
    if (stdout.includes('not loaded') || stdout.includes('not installed')) {
      logger.info('Gateway service not installed, registering now...')
      await this.installGatewayService()
    }
  }

  /**
   * Unregister gateway system service before npm uninstall
   */
  private async uninstallGatewayService(): Promise<void> {
    try {
      const shellEnv = await getShellEnv()
      const openclawPath = await findExecutableInEnv('openclaw')
      if (!openclawPath) return

      await this.execOpenClawCommandWithResult(openclawPath, ['gateway', 'uninstall'], shellEnv)
      logger.info('Gateway service unregistered')
    } catch (error) {
      logger.warn('Failed to unregister gateway service:', error as Error)
    }
  }

  /**
   * Uninstall OpenClaw using npm
   */
  public async uninstall(): Promise<OperationResult> {
    // Stop and unregister the gateway service before npm uninstall
    if (this.gatewayStatus === 'running') {
      await this.stopGateway()
    }
    await this.uninstallGatewayService()

    const npmPath = (await findExecutableInEnv('npm')) || 'npm'

    const npmArgs = ['uninstall', '-g', 'openclaw']

    // Keep the command string for logging and sudo retry
    const npmCommand = `"${npmPath}" uninstall -g openclaw`

    // On Windows, wrap npm path in quotes if it contains spaces and is not already quoted
    const needsQuotes = isWin && npmPath.includes(' ') && !npmPath.startsWith('"')
    const processedNpmPath = needsQuotes ? `"${npmPath}"` : npmPath

    logger.info(`Uninstalling OpenClaw with command: ${processedNpmPath} ${npmArgs.join(' ')}`)
    this.sendInstallProgress(`Running: ${processedNpmPath} ${npmArgs.join(' ')}`)

    const shellEnv = await getShellEnv()

    return new Promise((resolve) => {
      try {
        const uninstallProcess = crossPlatformSpawn(processedNpmPath, npmArgs, { env: shellEnv })

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
            resolve({ success: true })
          } else {
            logger.error(`OpenClaw uninstall failed with code ${code}`, { stderr: stderr.trim() })

            // Detect EACCES permission error and retry with sudo
            if (stderr.includes('EACCES') || stderr.includes('permission denied')) {
              logger.info('Permission denied, retrying uninstall with sudo-prompt...')
              this.sendInstallProgress('Permission denied. Requesting administrator access...')

              exec(npmCommand, { name: 'Cherry Studio' }, (error, stdout) => {
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
                  resolve({ success: true })
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
  public async startGateway(_: Electron.IpcMainInvokeEvent, port?: number): Promise<OperationResult> {
    this.gatewayPort = port ?? DEFAULT_GATEWAY_PORT

    // Prevent concurrent startup calls
    if (this.gatewayStatus === 'starting') {
      return { success: false, message: 'Gateway is already starting' }
    }

    // Refresh shell env first so findExecutableInEnv and crossPlatformSpawn both use the same fresh env
    const shellEnv = await refreshShellEnv()
    const openclawPath = await findExecutableInEnv('openclaw')
    if (!openclawPath) {
      return {
        success: false,
        message: 'OpenClaw binary not found. Please install OpenClaw first.'
      }
    }

    const alreadyRunning = await this.checkGatewayStatus(openclawPath, shellEnv)
    if (alreadyRunning) {
      this.gatewayStatus = 'running'
      logger.info(`Reusing existing gateway on port ${this.gatewayPort}`)
      return { success: true }
    }

    this.gatewayStatus = 'starting'

    try {
      await this.ensureGatewayServiceInstalled(openclawPath, shellEnv)
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
   * Start gateway via `openclaw gateway start` and wait for it to become ready
   */
  private async startAndWaitForGateway(openclawPath: string, shellEnv: Record<string, string>): Promise<void> {
    logger.info(`Starting gateway service: ${openclawPath} gateway start`)
    const { code, stdout, stderr } = await this.execOpenClawCommandWithResult(
      openclawPath,
      ['gateway', 'start', '--force'],
      shellEnv
    )
    logger.info('Gateway start result:', { code, stdout: stdout.trim(), stderr: stderr.trim() })

    if (code !== 0) {
      throw new Error(stderr.trim() || `gateway start exited with code ${code}`)
    }

    // Wait for gateway to become ready (max 30 seconds)
    const maxWaitMs = 30000
    const pollIntervalMs = 1000
    const startTime = Date.now()
    let pollCount = 0

    while (Date.now() - startTime < maxWaitMs) {
      await new Promise((r) => setTimeout(r, pollIntervalMs))
      pollCount++

      logger.debug(`Polling gateway status (attempt ${pollCount})...`)
      const isRunning = await this.checkGatewayStatus(openclawPath, shellEnv)
      if (isRunning) {
        logger.info(`Gateway is running (verified after ${pollCount} polls)`)
        return
      }

      const { status } = await this.probeGatewayHealth()
      if (status === 'healthy') {
        logger.info(`Gateway port ${this.gatewayPort} is open (verified after ${pollCount} polls)`)
        return
      }
    }

    throw new Error(`Gateway failed to start within ${maxWaitMs}ms (${pollCount} polls)`)
  }

  /**
   * Stop the OpenClaw Gateway
   */
  public async stopGateway(): Promise<OperationResult> {
    try {
      const openclawPath = await findExecutableInEnv('openclaw')
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
    timeoutMs = 10000
  ): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const proc = crossPlatformSpawn(openclawPath, args, {
        env: { ...env, OPENCLAW_CONFIG_PATH }
      })

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
   * Restart the OpenClaw Gateway
   */
  public async restartGateway(): Promise<OperationResult> {
    const openclawPath = await findExecutableInEnv('openclaw')
    if (!openclawPath) {
      this.gatewayStatus = 'error'
      return { success: false, message: 'OpenClaw binary not found' }
    }
    const shellEnv = await getShellEnv()
    const { code, stderr } = await this.execOpenClawCommandWithResult(openclawPath, ['gateway', 'restart'], shellEnv)
    if (code !== 0) {
      this.gatewayStatus = 'error'
      return { success: false, message: stderr.trim() || `Restart failed with code ${code}` }
    }
    return { success: true }
  }

  /**
   * Get Gateway status. Probes the port when idle to detect externally-started gateways.
   */
  public async getStatus(): Promise<{ status: GatewayStatus; port: number }> {
    if (this.gatewayStatus === 'stopped' || this.gatewayStatus === 'error') {
      const { status } = await this.probeGatewayHealth()
      if (status === 'healthy') {
        logger.info(`Detected externally running gateway on port ${this.gatewayPort}`)
        this.gatewayStatus = 'running'
      }
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
    return this.probeGatewayHealth()
  }

  /**
   * Probe gateway health by running `openclaw gateway health`.
   * Does NOT check gatewayStatus — callers that need to detect
   * externally-started gateways should call this directly.
   */
  private async probeGatewayHealth(): Promise<HealthInfo> {
    try {
      const openclawPath = await findExecutableInEnv('openclaw')
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
  ): Promise<OperationResult> {
    try {
      // Ensure config directory exists
      if (!fs.existsSync(OPENCLAW_CONFIG_DIR)) {
        fs.mkdirSync(OPENCLAW_CONFIG_DIR, { recursive: true })
      }

      // Read existing cherry config, or copy from original openclaw.json as base
      let config: OpenClawConfig = {}
      if (fs.existsSync(OPENCLAW_CONFIG_PATH)) {
        try {
          const content = fs.readFileSync(OPENCLAW_CONFIG_PATH, 'utf-8')
          config = JSON.parse(content)
        } catch {
          logger.warn('Failed to parse existing Cherry OpenClaw config, creating new one')
        }
      } else if (fs.existsSync(OPENCLAW_ORIGINAL_CONFIG_PATH)) {
        try {
          const content = fs.readFileSync(OPENCLAW_ORIGINAL_CONFIG_PATH, 'utf-8')
          config = JSON.parse(content)
          logger.info('Using original openclaw.json as base template for openclaw.cherry.json')
        } catch {
          logger.warn('Failed to parse original openclaw.json, creating new config')
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
      const statusProcess = crossPlatformSpawn(openclawPath, ['gateway', 'status'], {
        env: { ...env, OPENCLAW_CONFIG_PATH }
      })

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
