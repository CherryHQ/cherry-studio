import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isMac, isWin } from '@main/core/platform'
import { mergeBinaryExecutionEnv } from '@main/utils/binaryEnv'
import { removeEnvProxy } from '@main/utils/processRunner'
import { getRawShellEnv, getShellEnv } from '@main/utils/shellEnv'
import { CODE_CLI_TOOL_PRESET_MAP } from '@shared/data/presets/codeCliTools'
import type { CodeCliRunInput } from '@shared/ipc/schemas/codeCli'
import {
  CodeCli,
  LOGIN_CAPABLE_CLI_TOOLS,
  TerminalApp,
  type TerminalConfig,
  type TerminalConfigWithCommand
} from '@shared/types/codeCli'
import type { OperationResult } from '@shared/types/codeTools'
import { formatGeminiGatewayModelId } from '@shared/utils/apiGateway'
import type { CliConfigWriteFile, FileConfiguredCli } from '@shared/utils/cliConfig'
import { execFile, spawn } from 'child_process'
import { promisify } from 'util'

import { writeCliConfigFiles } from './configWriter'
import { sanitizeEnvForLogging } from './envRedaction'
import { isShellSafeModelId, posixQuote } from './shellQuote'
import {
  MACOS_TERMINALS,
  MACOS_TERMINALS_WITH_COMMANDS,
  WINDOWS_TERMINALS,
  WINDOWS_TERMINALS_WITH_COMMANDS
} from './terminals'

const execAsync = promisify(require('child_process').exec)
const execFileAsync = promisify(execFile)
const logger = loggerService.withContext('CodeCliService')
const MACOS_APPLICATION_LOOKUP_SCRIPT = [
  'ObjC.import("AppKit")',
  'function run(argv) {',
  '  const url = $.NSWorkspace.sharedWorkspace.URLForApplicationWithBundleIdentifier(argv[0])',
  '  return url ? ObjC.unwrap(url.path) : ""',
  '}'
].join('\n')

@Injectable('CodeCliService')
@ServicePhase(Phase.Background)
export class CodeCliService extends BaseService {
  // Static properties for cleanup management (avoid listener accumulation)
  private static pendingBatCleanups = new Set<string>()
  private static exitCleanupRegistered = false

  private terminalsCache: {
    terminals: TerminalConfig[]
    timestamp: number
  } | null = null
  private readonly TERMINALS_CACHE_DURATION = 1000 * 60 * 5 // 5 minutes cache for terminals

  protected async onInit(): Promise<void> {
    if (isMac || isWin) {
      void this.preloadTerminals()
    }
  }

  /**
   * Read-only probe of whether the user already has a Claude Code CLI
   * subscription login (Claude Pro/Max OAuth) usable by the Agent SDK. Never
   * reads or stores the credential value itself — only its presence.
   *
   * macOS: the OAuth token lives in the global login Keychain under the generic
   * password service `Claude Code-credentials` (independent of CLAUDE_CONFIG_DIR);
   * we query existence without `-w` so no secret is read and no ACL prompt fires.
   * Linux/Windows: it lives in `<CLAUDE_CONFIG_DIR>/.credentials.json` (default
   * `~/.claude`). A present token may still be expired — the SDK refreshes on use;
   * this is a best-effort "is the user signed in" hint for the settings UI.
   */
  public async checkClaudeLogin(): Promise<boolean> {
    if (isMac) {
      try {
        await execAsync('security find-generic-password -s "Claude Code-credentials"', { timeout: 3000 })
        return true
      } catch {
        // `security` exits non-zero when the keychain item is absent — the
        // normal "not signed in" signal, so this path stays silent.
        return false
      }
    }
    try {
      // Resolve from the same source the runtime uses (settingsBuilder reads the
      // shell CLAUDE_CONFIG_DIR), not raw process.env: a GUI-launched Electron
      // process does not inherit rc-exported vars, so probing process.env alone
      // falsely reports "not signed in".
      const shellEnv = await getShellEnv()
      const configDir =
        shellEnv.CLAUDE_CONFIG_DIR ||
        process.env.CLAUDE_CONFIG_DIR ||
        path.join(application.getPath('sys.home'), '.claude')
      return fs.existsSync(path.join(configDir, '.credentials.json'))
    } catch (error) {
      // A probe failure here (e.g. login-shell env resolution throwing on a
      // broken rc file) is NOT "not signed in" — log it so a genuinely
      // signed-in user's stuck "not signed in" card is diagnosable instead of
      // silently swallowed.
      logger.warn('Failed to probe Claude login state; reporting not signed in', error as Error)
      return false
    }
  }

  protected async onStop(): Promise<void> {
    this.terminalsCache = null
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

  /**
   * Check if a single terminal is available
   */
  private async checkTerminalAvailability(terminal: TerminalConfig): Promise<TerminalConfig | null> {
    if (isMac && terminal.bundleId) {
      if (terminal.id === TerminalApp.SYSTEM_DEFAULT) {
        return terminal
      }

      const { stdout } = await execFileAsync(
        '/usr/bin/osascript',
        ['-l', 'JavaScript', '-e', MACOS_APPLICATION_LOOKUP_SCRIPT, terminal.bundleId],
        { timeout: 3000 }
      )
      return stdout.trim() ? terminal : null
    }

    try {
      if (isWin) {
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
   * Check Windows terminal availability.
   */
  private async checkWindowsTerminalAvailability(terminal: TerminalConfig): Promise<TerminalConfig | null> {
    try {
      switch (terminal.id) {
        case TerminalApp.CMD:
          // CMD is always available on Windows
          return terminal

        case TerminalApp.POWERSHELL:
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

        case TerminalApp.WINDOWS_TERMINAL:
          // Check for Windows Terminal via where command (doesn't launch the terminal)
          try {
            await execAsync('where wt', { timeout: 3000 })
            return terminal
          } catch {
            return null
          }

        case TerminalApp.WSL:
          // Check for WSL
          try {
            await execAsync('wsl --status', { timeout: 3000 })
            return terminal
          } catch {
            return null
          }

        default:
          return await this.checkPathTerminalAvailability(terminal)
      }
    } catch (error) {
      logger.debug(`Windows terminal ${terminal.id} not available:`, error as Error)
      return null
    }
  }

  private async checkPathTerminalAvailability(terminal: TerminalConfig): Promise<TerminalConfig | null> {
    try {
      const command = terminal.id === TerminalApp.ALACRITTY ? 'alacritty' : 'wezterm'
      await execAsync(`${command} --version`, { timeout: 3000 })
      return terminal
    } catch {
      return null
    }
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
      let hasProbeFailure = false
      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
          availableTerminals.push(result.value as TerminalConfig)
        } else if (result.status === 'rejected') {
          hasProbeFailure = true
          logger.debug(`Terminal check failed for ${terminalList[index].id}:`, result.reason)
        }
      })

      const endTime = Date.now()
      logger.info(
        `Terminal availability check completed in ${endTime - startTime}ms, found ${availableTerminals.length} terminals`
      )

      if (hasProbeFailure) {
        logger.warn('Terminal availability check was incomplete; preserving the previous cache if available')
        return this.terminalsCache?.terminals ?? availableTerminals
      }

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
    const defaultTerminal = isWin ? TerminalApp.CMD : TerminalApp.SYSTEM_DEFAULT

    if (terminalId) {
      const requestedTerminal = terminalCommands.find(
        (t) => t.id === terminalId && availableTerminals.some((at) => at.id === t.id)
      )

      if (requestedTerminal) {
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
   * Get available terminals for the current platform
   */
  public async getAvailableTerminalsForPlatform(): Promise<TerminalConfig[]> {
    if (isMac || isWin) {
      return this.getAvailableTerminals()
    }
    // For other platforms, return empty array for now
    return []
  }

  /** Transactional write of a file-configured CLI's config files (code_cli.write_config). */
  public async writeConfigFiles(cliTool: FileConfiguredCli, files: CliConfigWriteFile[]): Promise<void> {
    return writeCliConfigFiles(cliTool, files)
  }

  async run(input: CodeCliRunInput): Promise<OperationResult> {
    const { cliTool, directory } = input
    logger.info(`Starting CLI tool launch: ${cliTool} in directory: ${directory}`)
    logger.debug(`Launch mode: ${input.mode}`)
    if (cliTool === CodeCli.OPENCLAW) {
      const message = 'OpenClaw is managed through openclaw.* IPC, not code_cli.run'
      logger.error(message)
      return { success: false, message }
    }

    const normal = input.mode === 'normal' ? input : null
    const isLoginFlow = input.mode === 'login-flow'
    const isProviderlessCli = cliTool === CodeCli.QODER_CLI || cliTool === CodeCli.GITHUB_COPILOT_CLI
    // "Own login" run: the CLI uses its own stored account login, so no Cherry
    // provider/model is injected (the renderer already cleared any prior config).
    // Gated to login-capable tools so a genuinely missing provider still errors.
    const isOwnLoginRun = input.mode === 'own-login' && LOGIN_CAPABLE_CLI_TOOLS.has(cliTool)
    // The IPC schema already enforces non-empty ids on the normal arm; these
    // guards keep the friendly messages for direct (test/service) callers.
    if (!isProviderlessCli && !isLoginFlow && !isOwnLoginRun && !normal?.providerId.trim()) {
      const message = `Provider ID is required for ${cliTool}`
      logger.error(message)
      return { success: false, message }
    }
    if (!isProviderlessCli && !isLoginFlow && !isOwnLoginRun && !normal?.model.trim()) {
      const message = `Model is required for ${cliTool}`
      logger.error(message)
      return { success: false, message }
    }

    if (!directory || !fs.existsSync(directory)) {
      const errorMessage = `Directory does not exist: ${directory}`
      logger.error(errorMessage)
      return {
        success: false,
        message: errorMessage
      }
    }

    const preset = CODE_CLI_TOOL_PRESET_MAP[cliTool]
    const executableName = preset.executable
    const spec = { name: executableName, tool: preset.miseTool }

    logger.debug(`Executable name: ${executableName}`)
    logger.debug(`Tool install spec: ${spec.tool}`)

    // Prefer mise/bundled binaries, then the user's login-shell PATH. Only
    // install when no currently available source can execute the CLI.
    const binaryManager = application.get('BinaryManager')
    let snapshot = (await binaryManager.getToolSnapshots([executableName]))[executableName]
    let { availability } = snapshot

    if (availability.source === 'none') {
      logger.info(`${cliTool} not installed, installing via BinaryManager...`)
      try {
        await binaryManager.installTool({ intent: snapshot.intent ?? spec })
        logger.info(`${cliTool} installed successfully`)
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        logger.error(`Failed to install ${cliTool}:`, error as Error)
        return { success: false, message: `Failed to install ${cliTool}: ${errorMessage}` }
      }

      snapshot = (await binaryManager.getToolSnapshots([executableName]))[executableName]
      availability = snapshot.availability
      if (availability.source === 'none') {
        const message = `${cliTool} is not available after install`
        logger.error(message)
        return { success: false, message }
      }
    }

    const executablePath = availability.path
    const usesCherryExecutionEnv = availability.source !== 'system'

    // Cherry's MISE_* variables are needed for currently available mise shims
    // and bundled binaries. A system CLI receives no Cherry environment: adding
    // it could redirect a user mise shim to Cherry's isolated data directory.
    // The install request above is the only operation that declares ownership;
    // execution depends only on this live availability fact.
    const rawShellEnv = usesCherryExecutionEnv ? await getRawShellEnv() : undefined
    const rawPathEnv = Object.fromEntries(
      Object.entries(rawShellEnv ?? {}).filter(([key]) => key.toLowerCase() === 'path')
    )
    const env: Record<string, string> = usesCherryExecutionEnv ? mergeBinaryExecutionEnv(rawPathEnv) : {}
    logger.debug(`Environment variables:`, Object.keys(env))

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
            const exportCmd = `export ${key}=${posixQuote(String(value))}`
            logger.debug(`Setting env var: ${key}=<redacted>`)
            return exportCmd
          })
          .join(' && ')
        const clearAmbientMise = usesCherryExecutionEnv
          ? 'for _cherry_mise_key in $(env | sed -n \'s/^\\(MISE_[A-Za-z0-9_]*\\)=.*/\\1/p\'); do unset "$_cherry_mise_key"; done'
          : ''
        return [clearAmbientMise, envCommands].filter(Boolean).join(' && ')
      }
    }

    const needsBatchCall = platform === 'win32' && ['.cmd', '.bat'].includes(path.extname(executablePath).toLowerCase())
    let baseCommand =
      platform === 'win32' ? `${needsBatchCall ? 'call ' : ''}"${executablePath}"` : posixQuote(executablePath)

    // OpenCode reads its provider AND default model from the opencode.json written by the
    // config flow (top-level `model: "<providerKey>/<modelId>"`), so the launch command
    // carries no model argument; we only disable its own auto-update.
    if (cliTool === CodeCli.OPEN_CODE) {
      env.OPENCODE_DISABLE_AUTOUPDATE = 'true'
    }

    // gemini-cli only loads ~/.gemini/.env (where GEMINI_API_KEY lives) when it
    // considers the launch directory "trusted"; a fresh directory otherwise falls
    // through to an interactive "Enter Gemini API Key" prompt even though
    // selectedType is already configured. This env var is gemini-cli's own
    // documented bypass, scoped to this one launched session only.
    if (cliTool === CodeCli.GEMINI_CLI) {
      env.GEMINI_CLI_TRUST_WORKSPACE = 'true'

      // gemini-cli resolves its model with precedence `--model` → GEMINI_MODEL →
      // settings.model.name, and its `resolveModel` rewrites any name ending in "flash" to a
      // default Gemini model. Pass the model on the command line (highest precedence, honored
      // verbatim) so the launched session hits the intended model. In gateway mode it needs the
      // `providerId:modelId` address the gateway parses from the URL path, carrying the sentinel
      // suffix so that rewrite can't corrupt a name ending in "flash" (see
      // GEMINI_GATEWAY_MODEL_SUFFIX); direct mode passes the bare model id.
      if (normal) {
        // The gateway serves only `/v1beta`; force the SDK's API version at launch so a stale
        // `GOOGLE_GENAI_API_VERSION=v1` exported in the user's shell can't redirect it to `/v1`.
        if (normal.gateway) env.GOOGLE_GENAI_API_VERSION = 'v1beta'
        const modelArg = normal.gateway ? formatGeminiGatewayModelId(normal.providerId, normal.model) : normal.model
        // Bare-concatenated into the launch command like OpenCode's model above, so reject a
        // model id carrying shell metacharacters rather than launch.
        if (!isShellSafeModelId(modelArg)) {
          const message = `Unsupported model id for ${cliTool}: ${modelArg}`
          logger.error(message)
          return { success: false, message }
        }
        baseCommand = `${baseCommand} --model ${modelArg}`
      }
    }

    // The Claude Code settings panel lands its terminal on the login flow rather
    // than a bare REPL. Modeled as a fixed boolean, NOT a free-form arg string:
    // this command is assembled into a shell string (and a Windows .bat), and
    // a renderer-supplied string would
    // be a shell-injection surface. A plain launch from the CLI page is unaffected.
    if (isLoginFlow) {
      baseCommand = `${baseCommand} /login`
    }

    switch (platform) {
      case 'darwin': {
        // macOS - Support multiple terminals
        const envPrefix = buildEnvPrefix(false)

        const command = envPrefix ? `${envPrefix} && ${baseCommand}` : baseCommand

        // Combine directory change with the main command to ensure they execute in the same shell session.
        // Single-quote the directory so a path containing spaces / `$()` / backticks / `;` can't inject
        // (double-quoting it only blocks `"`, leaving command substitution live).
        const fullCommand = `cd ${posixQuote(directory)} && clear && ${command}`

        const terminalConfig = await this.getTerminalConfig(input.terminal)
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
        const terminalConfig = await this.getTerminalConfig(input.terminal)
        logger.info(`Using terminal: ${terminalConfig.name} (${terminalConfig.id})`)

        // Get command and args from terminal configuration
        // Pass the bat file path as the command to execute
        const fullCommand = batFilePath
        const { command: cmd, args } = terminalConfig.command(directory, fullCommand)

        terminalCommand = cmd
        terminalArgs = args

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
              // A failed `which` spawn emits 'error'; without a listener that is
              // an uncaught exception in the main process. Treat it as not found.
              checkResult.on('error', () => resolve(-1))
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
          terminalArgs = ['-e', `cd ${posixQuote(directory)} && clear && ${command} && bash`]
        }
        break
      }
      default:
        throw new Error(`Unsupported operating system: ${platform}`)
    }

    const baseProcessEnv = usesCherryExecutionEnv ? rawShellEnv! : await getRawShellEnv()
    const processEnv = Object.fromEntries(
      Object.entries(baseProcessEnv).filter(
        ([key]) =>
          !usesCherryExecutionEnv ||
          !(platform === 'win32' ? key.toUpperCase().startsWith('MISE_') : key.startsWith('MISE_'))
      )
    )
    Object.assign(processEnv, env)
    removeEnvProxy(processEnv)

    // Launch terminal process
    try {
      logger.info(`Launching terminal with command: ${terminalCommand}`)
      logger.debug(`Terminal arguments:`, terminalArgs)
      logger.debug(`Working directory: ${directory}`)
      logger.debug(`Process environment keys: ${Object.keys(processEnv)}`)

      const child = spawn(terminalCommand, terminalArgs, {
        detached: true,
        stdio: 'ignore',
        cwd: directory,
        env: processEnv,
        shell: isWin
      })
      // spawn() fails asynchronously (e.g. ENOENT when the fallback terminal is
      // missing); without a listener that becomes an uncaught exception after
      // run() already reported success. Wait for the spawn/error race so launch
      // failures surface as a failed result instead.
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', resolve)
        child.once('error', reject)
      })
      child.on('error', (error) => logger.error('Terminal process error after launch', error))

      logger.info(`Launched ${cliTool} in new terminal window`)

      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      const failureMessage = `Failed to launch terminal: ${errorMessage}`
      logger.error(failureMessage, error as Error)
      return {
        success: false,
        message: failureMessage
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
