import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { loggerService } from '@logger'
import { isMac,isWin } from '@main/constant'
import { removeEnvProxy } from '@main/utils'
import { isUserInChina } from '@main/utils/ipService'
import { getBinaryName } from '@main/utils/process'
import {
  codeTools,
  MACOS_TERMINALS,
  MACOS_TERMINALS_WITH_COMMANDS,
  terminalApps,
  TerminalConfig,
  TerminalConfigWithCommand,
  WINDOWS_TERMINALS,
  WINDOWS_TERMINALS_WITH_COMMANDS
} from '@shared/config/constant'
import { spawn } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(require('child_process').exec)
const logger = loggerService.withContext('CodeToolsService')

interface VersionInfo {
  installed: string | null
  latest: string | null
  needsUpdate: boolean
}

class CodeToolsService {
  private versionCache: Map<string, { version: string; timestamp: number }> = new Map()
  private terminalsCache: { terminals: TerminalConfig[]; timestamp: number } | null = null
  private customTerminalPaths: Map<string, string> = new Map() // Store user-configured terminal paths
  private readonly CACHE_DURATION = 1000 * 60 * 30 // 30 minutes cache
  private readonly TERMINALS_CACHE_DURATION = 1000 * 60 * 5 // 5 minutes cache for terminals

  constructor() {
    this.getBunPath = this.getBunPath.bind(this)
    this.getPackageName = this.getPackageName.bind(this)
    this.getCliExecutableName = this.getCliExecutableName.bind(this)
    this.isPackageInstalled = this.isPackageInstalled.bind(this)
    this.getVersionInfo = this.getVersionInfo.bind(this)
    this.updatePackage = this.updatePackage.bind(this)
    this.run = this.run.bind(this)

    if (isMac || isWin) {
      this.preloadTerminals()
    }
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

  public async getBunPath() {
    const dir = path.join(os.homedir(), '.cherrystudio', 'bin')
    const bunName = await getBinaryName('bun')
    const bunPath = path.join(dir, bunName)
    return bunPath
  }

  public async getPackageName(cliTool: string) {
    switch (cliTool) {
      case codeTools.claudeCode:
        return '@anthropic-ai/claude-code'
      case codeTools.geminiCli:
        return '@google/gemini-cli'
      case codeTools.openaiCodex:
        return '@openai/codex'
      case codeTools.qwenCode:
        return '@qwen-code/qwen-code'
      case codeTools.iFlowCli:
        return '@iflow-ai/iflow-cli'
      default:
        throw new Error(`Unsupported CLI tool: ${cliTool}`)
    }
  }

  public async getCliExecutableName(cliTool: string) {
    switch (cliTool) {
      case codeTools.claudeCode:
        return 'claude'
      case codeTools.geminiCli:
        return 'gemini'
      case codeTools.openaiCodex:
        return 'codex'
      case codeTools.qwenCode:
        return 'qwen'
      case codeTools.iFlowCli:
        return 'iflow'
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
            await execAsync('powershell -Command "Get-Host"', { timeout: 3000 })
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
    const terminalCommands =
      isWin ? WINDOWS_TERMINALS_WITH_COMMANDS : MACOS_TERMINALS_WITH_COMMANDS
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

  private async isPackageInstalled(cliTool: string): Promise<boolean> {
    const executableName = await this.getCliExecutableName(cliTool)
    const binDir = path.join(os.homedir(), '.cherrystudio', 'bin')
    const executablePath = path.join(binDir, executableName + (isWin ? '.exe' : ''))

    // Ensure bin directory exists
    if (!fs.existsSync(binDir)) {
      fs.mkdirSync(binDir, { recursive: true })
    }

    return fs.existsSync(executablePath)
  }

  /**
   * Get version information for a CLI tool
   */
  public async getVersionInfo(cliTool: string): Promise<VersionInfo> {
    logger.info(`Starting version check for ${cliTool}`)
    const packageName = await this.getPackageName(cliTool)
    const isInstalled = await this.isPackageInstalled(cliTool)

    let installedVersion: string | null = null
    let latestVersion: string | null = null

    // Get installed version if package is installed
    if (isInstalled) {
      logger.info(`${cliTool} is installed, getting current version`)
      try {
        const executableName = await this.getCliExecutableName(cliTool)
        const binDir = path.join(os.homedir(), '.cherrystudio', 'bin')
        const executablePath = path.join(binDir, executableName + (isWin ? '.exe' : ''))

        const { stdout } = await execAsync(`"${executablePath}" --version`, { timeout: 10000 })
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

    // Get latest version from npm (with cache)
    const cacheKey = `${packageName}-latest`
    const cached = this.versionCache.get(cacheKey)
    const now = Date.now()

    if (cached && now - cached.timestamp < this.CACHE_DURATION) {
      logger.info(`Using cached latest version for ${packageName}: ${cached.version}`)
      latestVersion = cached.version
    } else {
      logger.info(`Fetching latest version for ${packageName} from npm`)
      try {
        // Get registry URL
        const registryUrl = await this.getNpmRegistryUrl()

        // Fetch package info directly from npm registry API
        const packageUrl = `${registryUrl}/${packageName}/latest`
        const response = await fetch(packageUrl, {
          signal: AbortSignal.timeout(15000)
        })

        if (!response.ok) {
          throw new Error(`Failed to fetch package info: ${response.statusText}`)
        }

        const packageInfo = await response.json()
        latestVersion = packageInfo.version
        logger.info(`${packageName} latest version: ${latestVersion}`)

        // Cache the result
        this.versionCache.set(cacheKey, { version: latestVersion!, timestamp: now })
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

    const needsUpdate = !!(installedVersion && latestVersion && installedVersion !== latestVersion)
    logger.info(
      `Version check result for ${cliTool}: installed=${installedVersion}, latest=${latestVersion}, needsUpdate=${needsUpdate}`
    )

    return {
      installed: installedVersion,
      latest: latestVersion,
      needsUpdate
    }
  }

  /**
   * Get npm registry URL based on user location
   */
  private async getNpmRegistryUrl(): Promise<string> {
    try {
      const inChina = await isUserInChina()
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
   * Update a CLI tool to the latest version
   */
  public async updatePackage(cliTool: string): Promise<{ success: boolean; message: string }> {
    logger.info(`Starting update process for ${cliTool}`)
    try {
      const packageName = await this.getPackageName(cliTool)
      const bunPath = await this.getBunPath()
      const bunInstallPath = path.join(os.homedir(), '.cherrystudio')
      const registryUrl = await this.getNpmRegistryUrl()

      const installEnvPrefix =
        isWin
          ? `set "BUN_INSTALL=${bunInstallPath}" && set "NPM_CONFIG_REGISTRY=${registryUrl}" &&`
          : `export BUN_INSTALL="${bunInstallPath}" && export NPM_CONFIG_REGISTRY="${registryUrl}" &&`

      const updateCommand = `${installEnvPrefix} "${bunPath}" install -g ${packageName}`
      logger.info(`Executing update command: ${updateCommand}`)

      await execAsync(updateCommand, { timeout: 60000 })
      logger.info(`Successfully executed update command for ${cliTool}`)

      // Clear version cache for this package
      const cacheKey = `${packageName}-latest`
      this.versionCache.delete(cacheKey)
      logger.debug(`Cleared version cache for ${packageName}`)

      const successMessage = `Successfully updated ${cliTool} to the latest version`
      logger.info(successMessage)
      return {
        success: true,
        message: successMessage
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      const failureMessage = `Failed to update ${cliTool}: ${errorMessage}`
      logger.error(failureMessage, error as Error)
      return {
        success: false,
        message: failureMessage
      }
    }
  }

  async run(
    _: Electron.IpcMainInvokeEvent,
    cliTool: string,
    _model: string,
    directory: string,
    env: Record<string, string>,
    options: { autoUpdateToLatest?: boolean; terminal?: string } = {}
  ) {
    logger.info(`Starting CLI tool launch: ${cliTool} in directory: ${directory}`)
    logger.debug(`Environment variables:`, Object.keys(env))
    logger.debug(`Options:`, options)

    const packageName = await this.getPackageName(cliTool)
    const bunPath = await this.getBunPath()
    const executableName = await this.getCliExecutableName(cliTool)
    const binDir = path.join(os.homedir(), '.cherrystudio', 'bin')
    const executablePath = path.join(binDir, executableName + (isWin ? '.exe' : ''))

    logger.debug(`Package name: ${packageName}`)
    logger.debug(`Bun path: ${bunPath}`)
    logger.debug(`Executable name: ${executableName}`)
    logger.debug(`Executable path: ${executablePath}`)

    // Check if package is already installed
    const isInstalled = await this.isPackageInstalled(cliTool)

    // Check for updates and auto-update if requested
    let updateMessage = ''
    if (isInstalled && options.autoUpdateToLatest) {
      logger.info(`Auto update to latest enabled for ${cliTool}`)
      try {
        const versionInfo = await this.getVersionInfo(cliTool)
        if (versionInfo.needsUpdate) {
          logger.info(`Update available for ${cliTool}: ${versionInfo.installed} -> ${versionInfo.latest}`)
          logger.info(`Auto-updating ${cliTool} to latest version`)
          updateMessage = ` && echo "Updating ${cliTool} from ${versionInfo.installed} to ${versionInfo.latest}..."`
          const updateResult = await this.updatePackage(cliTool)
          if (updateResult.success) {
            logger.info(`Update completed successfully for ${cliTool}`)
            updateMessage += ` && echo "Update completed successfully"`
          } else {
            logger.error(`Update failed for ${cliTool}: ${updateResult.message}`)
            updateMessage += ` && echo "Update failed: ${updateResult.message}"`
          }
        } else if (versionInfo.installed && versionInfo.latest) {
          logger.info(`${cliTool} is already up to date (${versionInfo.installed})`)
          updateMessage = ` && echo "${cliTool} is up to date (${versionInfo.installed})"`
        }
      } catch (error) {
        logger.warn(`Failed to check version for ${cliTool}:`, error as Error)
      }
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
      logger.info('Environment variable values:', env)

      if (isWindows) {
        // Windows uses set command
        return Object.entries(env)
          .map(([key, value]) => `set "${key}=${value.replace(/"/g, '\\"')}"`)
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
            logger.info(`Setting env var: ${key}="${sanitizedValue}"`)
            logger.info(`Export command: ${exportCmd}`)
            return exportCmd
          })
          .join(' && ')
        return envCommands
      }
    }

    let baseCommand = isWin ? `"${executablePath}"` : `"${bunPath}" "${executablePath}"`

    // Add configuration parameters for OpenAI Codex
    if (cliTool === codeTools.openaiCodex && env.OPENAI_MODEL_PROVIDER && env.OPENAI_MODEL_PROVIDER != 'openai') {
      const provider = env.OPENAI_MODEL_PROVIDER
      const model = env.OPENAI_MODEL
      // delete the latest /
      const baseUrl = env.OPENAI_BASE_URL.replace(/\/$/, '')

      const configParams = [
        `--config model_provider="${provider}"`,
        `--config model="${model}"`,
        `--config model_providers.${provider}.name="${provider}"`,
        `--config model_providers.${provider}.base_url="${baseUrl}"`,
        `--config model_providers.${provider}.env_key="OPENAI_API_KEY"`
      ].join(' ')
      baseCommand = `${baseCommand} ${configParams}`
    }

    const bunInstallPath = path.join(os.homedir(), '.cherrystudio')

    if (isInstalled) {
      // If already installed, run executable directly (with optional update message)
      if (updateMessage) {
        baseCommand = `echo "Checking ${cliTool} version..."${updateMessage} && ${baseCommand}`
      }
    } else {
      // If not installed, install first then run
      const registryUrl = await this.getNpmRegistryUrl()
      const installEnvPrefix =
        platform === 'win32'
          ? `set "BUN_INSTALL=${bunInstallPath}" && set "NPM_CONFIG_REGISTRY=${registryUrl}" &&`
          : `export BUN_INSTALL="${bunInstallPath}" && export NPM_CONFIG_REGISTRY="${registryUrl}" &&`

      const installCommand = `${installEnvPrefix} "${bunPath}" install -g ${packageName}`
      baseCommand = `echo "Installing ${packageName}..." && ${installCommand} && echo "Installation complete, starting ${cliTool}..." && ${baseCommand}`
    }

    switch (platform) {
      case 'darwin': {
        // macOS - Support multiple terminals
        const envPrefix = buildEnvPrefix(false)

        const command = envPrefix ? `${envPrefix} && ${baseCommand}` : baseCommand

        // Combine directory change with the main command to ensure they execute in the same shell session
        const fullCommand = `cd '${directory.replace(/'/g, "\\'")}' && clear && ${command}`

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
        const tempDir = path.join(os.tmpdir(), 'cherrystudio')
        const timestamp = Date.now()
        const batFileName = `launch_${cliTool}_${timestamp}.bat`
        const batFilePath = path.join(tempDir, batFileName)

        // Ensure temp directory exists
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true })
        }

        // Build bat file content, including debug information
        const batContent = [
          '@echo off',
          `title ${cliTool} - Cherry Studio`, // Set window title in bat file
          'echo ================================================',
          'echo Cherry Studio CLI Tool Launcher',
          `echo Tool: ${cliTool}`,
          `echo Directory: ${directory}`,
          `echo Time: ${new Date().toLocaleString()}`,
          'echo ================================================',
          '',
          ':: Change to target directory',
          `cd /d "${directory}" || (`,
          '  echo ERROR: Failed to change directory',
          `  echo Target directory: ${directory}`,
          '  pause',
          '  exit /b 1',
          ')',
          '',
          ':: Clear screen',
          'cls',
          '',
          ':: Execute command (without displaying environment variable settings)',
          command,
          '',
          ':: Command execution completed',
          'echo.',
          'echo Command execution completed.',
          'echo Press any key to close this window...',
          'pause >nul'
        ].join('\r\n')

        // Write to bat file
        try {
          fs.writeFileSync(batFilePath, batContent, 'utf8')
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

        // Set cleanup task (delete temp file after 5 minutes)
        setTimeout(() => {
          try {
            fs.existsSync(batFilePath) && fs.unlinkSync(batFilePath)
          } catch (error) {
            logger.warn(`Failed to cleanup temp bat file: ${error}`)
          }
        }, 10 * 1000) // Delete temp file after 10 seconds

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
        env: processEnv
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
}

export const codeToolsService = new CodeToolsService()
