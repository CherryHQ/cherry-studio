/**
 * TODO(v2): Performance — run() blocks up to ~100s before opening terminal
 *
 * Problem:
 * - regionService.isInChina() makes an HTTP request (5s timeout) on cache miss, called 2-3x per run()
 * - getVersionInfo() blocks on npm registry fetch (15s) + local --version (10s)
 * - updatePackage() blocks on bun install (60s) when autoUpdateToLatest is enabled
 * - All above run serially BEFORE spawn(terminal)
 *
 * Fix:
 * 1. (done) Egress detection is cached in RegionService (TTL + proxy-key invalidation)
 * 2. Extract local-only getInstalledVersion() for qwen-code --auth-type check
 * 3. Move getVersionInfo() + updatePackage() to fire-and-forget background task
 * 4. Cache getNpmRegistryUrl() at instance level
 * 5. Track background update promise in lifecycle (registerDisposable / onStop)
 */
import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isMac, isWin } from '@main/core/platform'
import { regionService } from '@main/services/RegionService'
import { removeEnvProxy } from '@main/utils'
import { getBinaryExecutionEnv, getBinaryPath, isBinaryExists } from '@main/utils/process'
import { IpcChannel } from '@shared/IpcChannel'
import {
  type CliProviderConfig,
  codeCLI,
  type OpenCodeProviderConfig,
  terminalApps,
  type TerminalConfig,
  type TerminalConfigWithCommand
} from '@shared/types/codeCli'
import type { CodeToolsRunResult } from '@shared/types/codeTools'
import { spawn } from 'child_process'
import { promisify } from 'util'

import { getCliConfigWriter } from './cliConfigFiles'
import { sanitizeEnvForLogging } from './envRedaction'
import {
  MACOS_TERMINALS,
  MACOS_TERMINALS_WITH_COMMANDS,
  WINDOWS_TERMINALS,
  WINDOWS_TERMINALS_WITH_COMMANDS
} from './terminals'

const execAsync = promisify(require('child_process').exec)
const logger = loggerService.withContext('CodeCliService')

interface VersionInfo {
  installed: string | null
  latest: string | null
  needsUpdate: boolean
}

@Injectable('CodeCliService')
@ServicePhase(Phase.Background)
export class CodeCliService extends BaseService {
  // Static properties for cleanup management (avoid listener accumulation)
  private static pendingBatCleanups = new Set<string>()
  private static exitCleanupRegistered = false

  private versionCache: Map<string, { version: string; timestamp: number }> = new Map()
  private terminalsCache: {
    terminals: TerminalConfig[]
    timestamp: number
  } | null = null
  private customTerminalPaths: Map<string, string> = new Map() // Store user-configured terminal paths
  private readonly CACHE_DURATION = 1000 * 60 * 30 // 30 minutes cache
  private readonly TERMINALS_CACHE_DURATION = 1000 * 60 * 5 // 5 minutes cache for terminals

  protected async onInit(): Promise<void> {
    this.registerIpcHandlers()
    if (isMac || isWin) {
      void this.preloadTerminals()
    }
  }

  private registerIpcHandlers(): void {
    this.ipcHandle(
      IpcChannel.CodeCli_Run,
      (
        event,
        cliTool: string,
        model: string,
        directory: string,
        env: Record<string, string>,
        options?: { autoUpdateToLatest?: boolean; terminal?: string },
        providerConfig?: CliProviderConfig
      ) => this.run(event, cliTool, model, directory, env, options, providerConfig)
    )
    this.ipcHandle(IpcChannel.CodeCli_GetAvailableTerminals, () => this.getAvailableTerminalsForPlatform())
    this.ipcHandle(IpcChannel.CodeCli_SetCustomTerminalPath, (_, terminalId: string, path: string) =>
      this.setCustomTerminalPath(terminalId, path)
    )
    this.ipcHandle(IpcChannel.CodeCli_GetCustomTerminalPath, (_, terminalId: string) =>
      this.getCustomTerminalPath(terminalId)
    )
    this.ipcHandle(IpcChannel.CodeCli_RemoveCustomTerminalPath, (_, terminalId: string) =>
      this.removeCustomTerminalPath(terminalId)
    )
  }

  protected async onStop(): Promise<void> {
    this.versionCache.clear()
    this.terminalsCache = null
    this.customTerminalPaths.clear()
  }

  /**
   * Preload available terminals in background
   */
  private async preloadTerminals(): Promise<void> {
    try {
      logger.info('Preloading available terminals...')
      await this.getAvailableTerminals()
      logger.info('Terminal preloading completed')
    } catch (error) {
      logger.warn('Terminal preloading failed:', error as Error)
    }
  }

  // npm package name used only for version registry lookups (not installation)
  private async getPackageName(cliTool: string) {
    switch (cliTool) {
      case codeCLI.claudeCode:
        return '@anthropic-ai/claude-code'
      case codeCLI.openaiCodex:
        return '@openai/codex'
      case codeCLI.openCode:
        return 'opencode-ai'
      case codeCLI.openclaw:
        return 'openclaw'
      case codeCLI.hermes:
        return 'hermes-agent'
      default:
        throw new Error(`Unsupported CLI tool: ${cliTool}`)
    }
  }

  private getToolInstallSpec(cliTool: string): { name: string; tool: string } {
    switch (cliTool) {
      case codeCLI.claudeCode:
        return { name: 'claude', tool: 'claude' }
      case codeCLI.openaiCodex:
        return { name: 'codex', tool: 'codex' }
      case codeCLI.openCode:
        return { name: 'opencode', tool: 'opencode' }
      case codeCLI.openclaw:
        return { name: 'openclaw', tool: 'npm:openclaw' }
      case codeCLI.hermes:
        return { name: 'hermes', tool: 'pipx:hermes-agent' }
      default:
        throw new Error(`Unsupported CLI tool: ${cliTool}`)
    }
  }

  public async getCliExecutableName(cliTool: string) {
    switch (cliTool) {
      case codeCLI.claudeCode:
        return 'claude'
      case codeCLI.openaiCodex:
        return 'codex'
      case codeCLI.openCode:
        return 'opencode'
      case codeCLI.openclaw:
        return 'openclaw'
      case codeCLI.hermes:
        return 'hermes'
      default:
        throw new Error(`Unsupported CLI tool: ${cliTool}`)
    }
  }

  /**
   * Check if a single terminal is available
   */
  private async checkTerminalAvailability(terminal: TerminalConfig): Promise<TerminalConfig | null> {
    try {
      if (isMac && terminal.bundleId) {
        // macOS: Check if application is installed via bundle ID with timeout
        const { stdout } = await execAsync(`mdfind "kMDItemCFBundleIdentifier == '${terminal.bundleId}'"`, {
          timeout: 3000
        })
        if (stdout.trim()) {
          return terminal
        }
      } else if (isWin) {
        // Windows: Check terminal availability
        return await this.checkWindowsTerminalAvailability(terminal)
      } else {
        // TODO: Check if terminal is available in linux
        await execAsync(`which ${terminal.id}`, { timeout: 2000 })
        return terminal
      }
    } catch (error) {
      logger.debug(`Terminal ${terminal.id} not available:`, error as Error)
    }
    return null
  }

  /**
   * Check Windows terminal availability (simplified - user configured paths)
   */
  private async checkWindowsTerminalAvailability(terminal: TerminalConfig): Promise<TerminalConfig | null> {
    try {
      switch (terminal.id) {
        case terminalApps.cmd:
          // CMD is always available on Windows
          return terminal

        case terminalApps.powershell:
          // Check for PowerShell in PATH
          try {
            await execAsync('powershell -Command "Get-Host"', {
              timeout: 3000
            })
            return terminal
          } catch {
            try {
              await execAsync('pwsh -Command "Get-Host"', { timeout: 3000 })
              return terminal
            } catch {
              return null
            }
          }

        case terminalApps.windowsTerminal:
          // Check for Windows Terminal via where command (doesn't launch the terminal)
          try {
            await execAsync('where wt', { timeout: 3000 })
            return terminal
          } catch {
            return null
          }

        case terminalApps.wsl:
          // Check for WSL
          try {
            await execAsync('wsl --status', { timeout: 3000 })
            return terminal
          } catch {
            return null
          }

        default:
          // For other terminals (Alacritty, WezTerm), check if user has configured custom path
          return await this.checkCustomTerminalPath(terminal)
      }
    } catch (error) {
      logger.debug(`Windows terminal ${terminal.id} not available:`, error as Error)
      return null
    }
  }

  /**
   * Check if user has configured custom path for terminal
   */
  private async checkCustomTerminalPath(terminal: TerminalConfig): Promise<TerminalConfig | null> {
    // Check if user has configured custom path
    const customPath = this.customTerminalPaths.get(terminal.id)
    if (customPath && fs.existsSync(customPath)) {
      try {
        await execAsync(`"${customPath}" --version`, { timeout: 3000 })
        return { ...terminal, customPath }
      } catch {
        return null
      }
    }

    // Fallback to PATH check
    try {
      const command = terminal.id === terminalApps.alacritty ? 'alacritty' : 'wezterm'
      await execAsync(`${command} --version`, { timeout: 3000 })
      return terminal
    } catch {
      return null
    }
  }

  /**
   * Set custom path for a terminal (called from settings UI)
   */
  public setCustomTerminalPath(terminalId: string, path: string): void {
    logger.info(`Setting custom path for terminal ${terminalId}: ${path}`)
    this.customTerminalPaths.set(terminalId, path)
    // Clear terminals cache to force refresh
    this.terminalsCache = null
  }

  /**
   * Get custom path for a terminal
   */
  public getCustomTerminalPath(terminalId: string): string | undefined {
    return this.customTerminalPaths.get(terminalId)
  }

  /**
   * Remove custom path for a terminal
   */
  public removeCustomTerminalPath(terminalId: string): void {
    logger.info(`Removing custom path for terminal ${terminalId}`)
    this.customTerminalPaths.delete(terminalId)
    // Clear terminals cache to force refresh
    this.terminalsCache = null
  }

  /**
   * Get available terminals (with caching and parallel checking)
   */
  private async getAvailableTerminals(): Promise<TerminalConfig[]> {
    const now = Date.now()

    // Check cache first
    if (this.terminalsCache && now - this.terminalsCache.timestamp < this.TERMINALS_CACHE_DURATION) {
      logger.info(`Using cached terminals list (${this.terminalsCache.terminals.length} terminals)`)
      return this.terminalsCache.terminals
    }

    logger.info('Checking available terminals in parallel...')
    const startTime = Date.now()

    // Get terminal list based on platform
    const terminalList = isWin ? WINDOWS_TERMINALS : MACOS_TERMINALS

    // Check all terminals in parallel
    const terminalPromises = terminalList.map((terminal) => this.checkTerminalAvailability(terminal))

    try {
      // Wait for all checks to complete with a global timeout
      const results = await Promise.allSettled(
        terminalPromises.map((p) =>
          Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))])
        )
      )

      const availableTerminals: TerminalConfig[] = []
      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
          availableTerminals.push(result.value as TerminalConfig)
        } else if (result.status === 'rejected') {
          logger.debug(`Terminal check failed for ${MACOS_TERMINALS[index].id}:`, result.reason)
        }
      })

      const endTime = Date.now()
      logger.info(
        `Terminal availability check completed in ${endTime - startTime}ms, found ${availableTerminals.length} terminals`
      )

      // Cache the results
      this.terminalsCache = {
        terminals: availableTerminals,
        timestamp: now
      }

      return availableTerminals
    } catch (error) {
      logger.error('Error checking terminal availability:', error as Error)
      // Return cached result if available, otherwise empty array
      return this.terminalsCache?.terminals || []
    }
  }

  /**
   * Get terminal config by ID, fallback to system default
   */
  private async getTerminalConfig(terminalId?: string): Promise<TerminalConfigWithCommand> {
    const availableTerminals = await this.getAvailableTerminals()
    const terminalCommands = isWin ? WINDOWS_TERMINALS_WITH_COMMANDS : MACOS_TERMINALS_WITH_COMMANDS
    const defaultTerminal = isWin ? terminalApps.cmd : terminalApps.systemDefault

    if (terminalId) {
      let requestedTerminal = terminalCommands.find(
        (t) => t.id === terminalId && availableTerminals.some((at) => at.id === t.id)
      )

      if (requestedTerminal) {
        // Apply custom path if configured
        const customPath = this.customTerminalPaths.get(terminalId)
        if (customPath && isWin) {
          requestedTerminal = this.applyCustomPath(requestedTerminal, customPath)
        }
        return requestedTerminal
      } else {
        logger.warn(`Requested terminal ${terminalId} not available, falling back to system default`)
      }
    }

    // Fallback to system default Terminal
    const systemTerminal = terminalCommands.find(
      (t) => t.id === defaultTerminal && availableTerminals.some((at) => at.id === t.id)
    )
    if (systemTerminal) {
      return systemTerminal
    }

    // If even system Terminal is not found, return the first available
    const firstAvailable = terminalCommands.find((t) => availableTerminals.some((at) => at.id === t.id))
    if (firstAvailable) {
      return firstAvailable
    }

    // Last resort fallback
    return terminalCommands.find((t) => t.id === defaultTerminal)!
  }

  /**
   * Apply custom path to terminal configuration
   */
  private applyCustomPath(terminal: TerminalConfigWithCommand, customPath: string): TerminalConfigWithCommand {
    return {
      ...terminal,
      customPath,
      command: (directory: string, fullCommand: string) => {
        const originalCommand = terminal.command(directory, fullCommand)
        return {
          ...originalCommand,
          command: customPath // Replace command with custom path
        }
      }
    }
  }

  /**
   * Get version information for a CLI tool
   */
  public async getVersionInfo(cliTool: string): Promise<VersionInfo> {
    logger.info(`Starting version check for ${cliTool}`)
    const packageName = await this.getPackageName(cliTool)
    const executableName = await this.getCliExecutableName(cliTool)
    const isInstalled = await isBinaryExists(executableName)

    let installedVersion: string | null = null
    let latestVersion: string | null = null

    // Get installed version if package is installed
    if (isInstalled) {
      logger.info(`${cliTool} is installed, getting current version`)
      try {
        const execPath = await getBinaryPath(executableName)
        const versionCommand = `"${execPath}"`

        const { stdout } = await execAsync(`${versionCommand} --version`, {
          env: { ...process.env, ...getBinaryExecutionEnv() },
          timeout: 10000
        })
        // Extract version number from output (format may vary by tool)
        const versionMatch = stdout.trim().match(/\d+\.\d+\.\d+/)
        installedVersion = versionMatch ? versionMatch[0] : stdout.trim().split(' ')[0]
        logger.info(`${cliTool} current installed version: ${installedVersion}`)
      } catch (error) {
        logger.warn(`Failed to get installed version for ${cliTool}:`, error as Error)
      }
    } else {
      logger.info(`${cliTool} is not installed`)
    }

    const spec = this.getToolInstallSpec(cliTool)

    // Get latest version from the backend registry (with cache)
    const cacheKey = `${packageName}-latest`
    const cached = this.versionCache.get(cacheKey)
    const now = Date.now()

    if (cached && now - cached.timestamp < this.CACHE_DURATION) {
      logger.info(`Using cached latest version for ${packageName}: ${cached.version}`)
      latestVersion = cached.version
    } else {
      logger.info(`Fetching latest version for ${packageName}`)
      try {
        latestVersion = await this.fetchLatestVersion(packageName, spec.tool)
        logger.info(`${packageName} latest version: ${latestVersion}`)

        // Cache the result
        this.versionCache.set(cacheKey, {
          version: latestVersion,
          timestamp: now
        })
        logger.debug(`Cached latest version for ${packageName}`)
      } catch (error) {
        logger.warn(`Failed to get latest version for ${packageName}:`, error as Error)
        // If we have a cached version, use it even if expired
        if (cached) {
          logger.info(`Using expired cached version for ${packageName}: ${cached.version}`)
          latestVersion = cached.version
        }
      }
    }

    const needsUpdate = !!(latestVersion && isInstalled && (!installedVersion || installedVersion !== latestVersion))
    logger.info(
      `Version check result for ${cliTool}: installed=${installedVersion}, latest=${latestVersion}, needsUpdate=${needsUpdate}`
    )

    return {
      installed: installedVersion,
      latest: latestVersion,
      needsUpdate
    }
  }

  private async fetchLatestVersion(packageName: string, toolSpec: string): Promise<string> {
    if (toolSpec.startsWith('pipx:')) {
      const response = await fetch(`https://pypi.org/pypi/${encodeURIComponent(packageName)}/json`, {
        signal: AbortSignal.timeout(15000)
      })
      if (!response.ok) {
        throw new Error(`Failed to fetch package info: ${response.statusText}`)
      }
      const packageInfo = (await response.json()) as { info?: { version?: string } }
      if (!packageInfo.info?.version) {
        throw new Error(`Missing PyPI version for ${packageName}`)
      }
      return packageInfo.info.version
    }

    const registryUrl = await this.getNpmRegistryUrl()
    const response = await fetch(`${registryUrl}/${packageName}/latest`, {
      signal: AbortSignal.timeout(15000)
    })
    if (!response.ok) {
      throw new Error(`Failed to fetch package info: ${response.statusText}`)
    }
    const packageInfo = (await response.json()) as { version?: string }
    if (!packageInfo.version) {
      throw new Error(`Missing npm version for ${packageName}`)
    }
    return packageInfo.version
  }

  /**
   * Get npm registry URL based on user location
   */
  private async getNpmRegistryUrl(): Promise<string> {
    try {
      const inChina = await regionService.isInChina()
      if (inChina) {
        logger.info('User in China, using Taobao npm mirror')
        return 'https://registry.npmmirror.com'
      } else {
        logger.info('User not in China, using default npm mirror')
        return 'https://registry.npmjs.org'
      }
    } catch (error) {
      logger.warn('Failed to detect user location, using default npm mirror')
      return 'https://registry.npmjs.org'
    }
  }

  /**
   * Get available terminals for the current platform
   */
  public async getAvailableTerminalsForPlatform(): Promise<TerminalConfig[]> {
    if (isMac || isWin) {
      return this.getAvailableTerminals()
    }
    // For other platforms, return empty array for now
    return []
  }

  /**
   * Update a CLI tool to the latest version via BinaryManager
   */
  public async updatePackage(cliTool: string): Promise<{ success: boolean; message: string }> {
    logger.info(`Starting update process for ${cliTool}`)
    try {
      const spec = this.getToolInstallSpec(cliTool)
      await application.get('BinaryManager').installTool(spec)
      // Clear version cache so next check fetches fresh data
      const packageName = await this.getPackageName(cliTool)
      this.versionCache.delete(`${packageName}-latest`)
      const successMessage = `Successfully updated ${cliTool} to the latest version`
      logger.info(successMessage)
      return { success: true, message: successMessage }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      const failureMessage = `Failed to update ${cliTool}: ${errorMessage}`
      logger.error(failureMessage, error as Error)
      return { success: false, message: failureMessage }
    }
  }

  async run(
    _: Electron.IpcMainInvokeEvent,
    cliTool: string,
    model: string,
    directory: string,
    env: Record<string, string>,
    options: { autoUpdateToLatest?: boolean; terminal?: string } = {},
    providerConfig?: CliProviderConfig
  ): Promise<CodeToolsRunResult> {
    logger.info(`Starting CLI tool launch: ${cliTool} in directory: ${directory}`)
    env = { ...getBinaryExecutionEnv(), ...env }
    logger.debug(`Environment variables:`, Object.keys(env))
    logger.debug(`Options:`, options)

    // Validate directory exists before proceeding
    if (!directory || !fs.existsSync(directory)) {
      const errorMessage = `Directory does not exist: ${directory}`
      logger.error(errorMessage)
      return {
        success: false,
        message: errorMessage,
        command: ''
      }
    }

    // File-based CLIs persist their provider selection to a native config file from the dedicated
    // `providerConfig` payload, so the selection survives across runs and credentials are not
    // injected as launch env. The launch `env` carries only user-defined vars.
    const configWriter = getCliConfigWriter(cliTool)
    if (configWriter) {
      if (!providerConfig) {
        const message = `Missing provider config for ${cliTool}`
        logger.error(message)
        return { success: false, message, command: '' }
      }
      try {
        await configWriter(providerConfig)
      } catch (error) {
        const message = `Failed to write ${cliTool} config file: ${error instanceof Error ? error.message : String(error)}`
        logger.error(message, error as Error)
        return { success: false, message, command: '' }
      }
    }

    const executableName = await this.getCliExecutableName(cliTool)
    const spec = this.getToolInstallSpec(cliTool)

    logger.debug(`Executable name: ${executableName}`)
    logger.debug(`Tool install spec: ${spec.tool}`)

    // Check if package is already installed
    let isInstalled = await isBinaryExists(executableName)

    // Install via BinaryManager if not present
    if (!isInstalled) {
      logger.info(`${cliTool} not installed, installing via BinaryManager...`)
      try {
        await application.get('BinaryManager').installTool(spec)
        isInstalled = true
        logger.info(`${cliTool} installed successfully`)
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        logger.error(`Failed to install ${cliTool}:`, error as Error)
        return { success: false, message: `Failed to install ${cliTool}: ${errorMessage}`, command: '' }
      }
    }

    // Re-verify the binary is on disk before spawning. getBinaryPath() below
    // silently falls back to the bare name when the file is missing, so without
    // this guard we'd launch a phantom (or a same-named binary on PATH) and
    // still report success.
    if (!(await isBinaryExists(executableName))) {
      const message = `${cliTool} is not available after install`
      logger.error(message)
      return { success: false, message, command: '' }
    }

    // OpenClaw starts as a background gateway, not a terminal process
    if (cliTool === codeCLI.openclaw) {
      try {
        const gatewayResult = await application.get('OpenClawService').startGateway()
        if (!gatewayResult.success) {
          return { success: false, message: gatewayResult.message || 'Failed to start OpenClaw gateway', command: '' }
        }
        const dashboardUrl = application.get('OpenClawService').getDashboardUrl()
        logger.info(`OpenClaw gateway started, dashboard: ${dashboardUrl}`)
        return { success: true, message: 'OpenClaw gateway started', command: dashboardUrl }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        logger.error('Failed to start OpenClaw gateway:', error as Error)
        return { success: false, message: `Failed to start OpenClaw gateway: ${errorMessage}`, command: '' }
      }
    }

    // Optional auto-update
    try {
      const versionInfo = await this.getVersionInfo(cliTool)
      if (options.autoUpdateToLatest && versionInfo.needsUpdate) {
        logger.info(`Auto-updating ${cliTool} from ${versionInfo.installed} to ${versionInfo.latest}`)
        await this.updatePackage(cliTool)
      }
    } catch (error) {
      logger.warn(`Failed to check version for ${cliTool}:`, error as Error)
    }

    // Select different terminal based on operating system
    const platform = process.platform
    let terminalCommand: string
    let terminalArgs: string[]

    // Build environment variable prefix (based on platform)
    const buildEnvPrefix = (isWindows: boolean) => {
      if (Object.keys(env).length === 0) {
        logger.info('No environment variables to set')
        return ''
      }

      logger.info('Setting environment variables:', Object.keys(env))
      logger.debug('Environment variable values:', sanitizeEnvForLogging(env))

      if (isWindows) {
        // Windows uses set command
        // Escape all cmd.exe metacharacters in env values to prevent command injection
        return Object.entries(env)
          .map(([key, value]) => `set "${key}=${escapeBatchText(value)}"`)
          .join(' && ')
      } else {
        // Unix-like systems use export command
        const validEntries = Object.entries(env).filter(([key, value]) => {
          if (!key || key.trim() === '') {
            return false
          }
          if (value === undefined || value === null) {
            return false
          }
          return true
        })

        const envCommands = validEntries
          .map(([key, value]) => {
            const sanitizedValue = String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
            const exportCmd = `export ${key}="${sanitizedValue}"`
            logger.debug(`Setting env var: ${key}=<redacted>`)
            return exportCmd
          })
          .join(' && ')
        return envCommands
      }
    }

    const executablePath = await getBinaryPath(executableName)
    let baseCommand = `"${executablePath}"`

    // OpenCode reads its provider from the opencode.json written above; here we only select the model
    // at launch (matching the written provider key) and disable its own auto-update.
    if (cliTool === codeCLI.openCode) {
      const providerName = (providerConfig as OpenCodeProviderConfig | undefined)?.providerName || 'Studio'
      baseCommand = `${baseCommand} --model Cherry-${providerName}/${model}`
      env.OPENCODE_DISABLE_AUTOUPDATE = 'true'
    }

    switch (platform) {
      case 'darwin': {
        // macOS - Support multiple terminals
        const envPrefix = buildEnvPrefix(false)

        const command = envPrefix ? `${envPrefix} && ${baseCommand}` : baseCommand

        // Combine directory change with the main command to ensure they execute in the same shell session
        const fullCommand = `cd "${directory.replace(/"/g, '\\"')}" && clear && ${command}`

        const terminalConfig = await this.getTerminalConfig(options.terminal)
        logger.info(`Using terminal: ${terminalConfig.name} (${terminalConfig.id})`)

        const { command: cmd, args } = terminalConfig.command(directory, fullCommand)
        terminalCommand = cmd
        terminalArgs = args
        break
      }
      case 'win32': {
        // Windows - Use temp bat file for debugging
        const envPrefix = buildEnvPrefix(true)
        const command = envPrefix ? `${envPrefix} && ${baseCommand}` : baseCommand

        // Create temp bat file for debugging and avoid complex command line escaping issues
        const tempDir = application.getPath('feature.cli.temp')
        const timestamp = Date.now()
        const batFileName = `launch_${cliTool}_${timestamp}.bat`
        const batFilePath = path.join(tempDir, batFileName)

        // Ensure temp directory exists
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true })
        }

        // Escape special characters in paths for Windows batch scripting
        // Using double quotes for compatibility with CMD

        // Build bat file content, including debug information
        // Use labels and goto to handle errors properly (fixes CMD control-flow issue)
        const batContent = [
          '@echo off',
          'chcp 65001 >nul 2>&1', // Switch to UTF-8 code page for international path support
          `title ${cliTool} - Cherry Studio`,
          'echo ================================================',
          'echo Cherry Studio CLI Tool Launcher',
          `echo Tool: ${CodeCliService.escapeBatchTextForEcho(cliTool)}`,
          `echo Directory: ${CodeCliService.escapeBatchTextForEcho(directory)}`,
          `echo Time: ${new Date().toLocaleString()}`,
          'echo ================================================',
          '',
          ':: Verify directory exists',
          `if not exist "${directory.replace(/%/g, '%%')}" goto :dir_missing`,
          '',
          ':: Change to target directory',
          `pushd "${directory.replace(/%/g, '%%')}"`,
          'if errorlevel 1 goto :pushd_failed',
          '',
          ':: Clear screen before running CLI',
          'cls',
          '',
          ':: Execute command',
          command,
          '',
          'goto :end',
          '',
          ':: Error handlers (using labels to ensure entire branch is conditional)',
          ':dir_missing',
          'echo ERROR: Directory does not exist',
          `echo Target: ${CodeCliService.escapeBatchTextForEcho(directory)}`,
          'pause',
          'exit /b 1',
          '',
          ':pushd_failed',
          'echo ERROR: Failed to change directory',
          'pause',
          'exit /b 1',
          '',
          ':end',
          'pause'
        ].join('\r\n')

        // Write to bat file
        try {
          fs.writeFileSync(batFilePath, batContent, 'utf8')
          // Set restrictive permissions for bat file
          fs.chmodSync(batFilePath, 0o600)
          logger.info(`Created temp bat file: ${batFilePath}`)
        } catch (error) {
          logger.error(`Failed to create bat file: ${error}`)
          throw new Error(`Failed to create launch script: ${error}`)
        }

        // Use selected terminal configuration
        const terminalConfig = await this.getTerminalConfig(options.terminal)
        logger.info(`Using terminal: ${terminalConfig.name} (${terminalConfig.id})`)

        // Get command and args from terminal configuration
        // Pass the bat file path as the command to execute
        const fullCommand = batFilePath
        const { command: cmd, args } = terminalConfig.command(directory, fullCommand)

        // Override if it's a custom terminal with a custom path
        if (terminalConfig.customPath) {
          terminalCommand = terminalConfig.customPath
          terminalArgs = args
        } else {
          terminalCommand = cmd
          terminalArgs = args
        }

        // Add to cleanup set
        CodeCliService.pendingBatCleanups.add(batFilePath)

        // Register exit handler only once (using process.once to avoid accumulation)
        if (!CodeCliService.exitCleanupRegistered) {
          process.once('exit', () => {
            // Clean up all remaining bat files on process exit
            for (const filePath of CodeCliService.pendingBatCleanups) {
              try {
                if (fs.existsSync(filePath)) {
                  fs.unlinkSync(filePath)
                  logger.debug(`Cleaned up temp bat file on exit: ${filePath}`)
                }
              } catch (error) {
                logger.warn(`Failed to cleanup temp bat file: ${error}`)
              }
            }
            CodeCliService.pendingBatCleanups.clear()
          })
          CodeCliService.exitCleanupRegistered = true
        }

        // Set timeout for cleanup (normal case - file deleted after 60 seconds)
        const cleanup = () => {
          try {
            if (fs.existsSync(batFilePath)) {
              fs.unlinkSync(batFilePath)
              logger.debug(`Cleaned up temp bat file: ${batFilePath}`)
            }
            // Remove from pending set
            CodeCliService.pendingBatCleanups.delete(batFilePath)
          } catch (error) {
            logger.warn(`Failed to cleanup temp bat file: ${error}`)
          }
        }

        setTimeout(cleanup, 60 * 1000)

        break
      }
      case 'linux': {
        // Linux - Try to use common terminal emulators
        const envPrefix = buildEnvPrefix(false)
        const command = envPrefix ? `${envPrefix} && ${baseCommand}` : baseCommand

        const linuxTerminals = ['gnome-terminal', 'konsole', 'deepin-terminal', 'xterm', 'x-terminal-emulator']
        let foundTerminal = 'xterm' // Default to xterm

        for (const terminal of linuxTerminals) {
          try {
            // Check if terminal exists
            const checkResult = spawn('which', [terminal], { stdio: 'pipe' })
            await new Promise((resolve) => {
              checkResult.on('close', (code) => {
                if (code === 0) {
                  foundTerminal = terminal
                }
                resolve(code)
              })
            })
            if (foundTerminal === terminal) break
          } catch (error) {
            // Continue trying next terminal
          }
        }

        if (foundTerminal === 'gnome-terminal') {
          terminalCommand = 'gnome-terminal'
          terminalArgs = ['--working-directory', directory, '--', 'bash', '-c', `clear && ${command}; exec bash`]
        } else if (foundTerminal === 'konsole') {
          terminalCommand = 'konsole'
          terminalArgs = ['--workdir', directory, '-e', 'bash', '-c', `clear && ${command}; exec bash`]
        } else if (foundTerminal === 'deepin-terminal') {
          terminalCommand = 'deepin-terminal'
          terminalArgs = ['-w', directory, '-e', 'bash', '-c', `clear && ${command}; exec bash`]
        } else {
          // Default to xterm
          terminalCommand = 'xterm'
          terminalArgs = ['-e', `cd "${directory}" && clear && ${command} && bash`]
        }
        break
      }
      default:
        throw new Error(`Unsupported operating system: ${platform}`)
    }

    const processEnv = { ...process.env, ...env }
    removeEnvProxy(processEnv as Record<string, string>)

    // Launch terminal process
    try {
      logger.info(`Launching terminal with command: ${terminalCommand}`)
      logger.debug(`Terminal arguments:`, terminalArgs)
      logger.debug(`Working directory: ${directory}`)
      logger.debug(`Process environment keys: ${Object.keys(processEnv)}`)

      spawn(terminalCommand, terminalArgs, {
        detached: true,
        stdio: 'ignore',
        cwd: directory,
        env: processEnv,
        shell: isWin
      })

      const successMessage = `Launched ${cliTool} in new terminal window`
      logger.info(successMessage)

      return {
        success: true,
        message: successMessage,
        command: `${terminalCommand} ${terminalArgs.join(' ')}`
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      const failureMessage = `Failed to launch terminal: ${errorMessage}`
      logger.error(failureMessage, error as Error)
      return {
        success: false,
        message: failureMessage,
        command: `${terminalCommand} ${terminalArgs.join(' ')}`
      }
    }
  }

  /**
   * Escape text for safe use in batch echo statements
   * Only handles critical issues: newlines and % characters
   * Preserves command syntax (e.g., &&) - use for constructed command strings
   * @param text - Raw text from command output or user input
   * @returns Escaped text safe for batch echo statements
   */
  private static escapeBatchTextForEcho(text: string): string {
    if (!text) return ''
    return text
      .replace(/%/g, '%%') // Escape % to avoid variable expansion
      .replace(/\r\n/g, ' ') // Windows newline to space
      .replace(/\n/g, ' ') // Unix newline to space
  }
}

/**
 * Escape text for safe use in Windows batch files
 * Handles ALL cmd.exe metacharacters to prevent command injection
 * Use this for arbitrary untrusted input that may contain any characters
 * @param text - Raw text that may contain user input or error messages
 * @returns Fully escaped text safe for batch files
 */
export function escapeBatchText(text: string): string {
  if (!text) return ''
  return text
    .replace(/\^/g, '^^') // Escape caret first (before other escapes)
    .replace(/%/g, '%%') // Escape % to avoid variable expansion
    .replace(/&/g, '^&') // Escape & command separator
    .replace(/\|/g, '^|') // Escape | pipe
    .replace(/>/g, '^>') // Escape > output redirect
    .replace(/</g, '^<') // Escape < input redirect
    .replace(/"/g, '""') // Escape double quotes to prevent echo injection
    .replace(/\r\n/g, ' ') // Windows newline to space
    .replace(/\n/g, ' ') // Unix newline to space
}
