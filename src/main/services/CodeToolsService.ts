import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { getBinaryName } from '@main/utils/process'
import { spawn } from 'child_process'

class CodeToolsService {
  constructor() {
    this.getBunPath = this.getBunPath.bind(this)
    this.getPackageName = this.getPackageName.bind(this)
    this.getCliExecutableName = this.getCliExecutableName.bind(this)
    this.isPackageInstalled = this.isPackageInstalled.bind(this)
    this.run = this.run.bind(this)
  }

  public async getBunPath() {
    const dir = path.join(os.homedir(), '.cherrystudio', 'bin')
    const bunName = await getBinaryName('bun')
    const bunPath = path.join(dir, bunName)
    return bunPath
  }

  public async getPackageName(cliTool: string) {
    if (cliTool === 'claude-code') {
      return '@anthropic-ai/claude-code'
    }
    if (cliTool === 'gemini-cli') {
      return '@google/gemini-cli'
    }
    return '@qwen-code/qwen-code'
  }

  public async getCliExecutableName(cliTool: string) {
    if (cliTool === 'claude-code') {
      return 'claude'
    }
    if (cliTool === 'gemini-cli') {
      return 'gemini'
    }
    return 'qwen'
  }

  private async isPackageInstalled(cliTool: string): Promise<boolean> {
    const executableName = await this.getCliExecutableName(cliTool)
    const binDir = path.join(os.homedir(), '.cherrystudio', 'bin')
    const executablePath = path.join(binDir, executableName + (process.platform === 'win32' ? '.exe' : ''))

    // Ensure bin directory exists
    if (!fs.existsSync(binDir)) {
      fs.mkdirSync(binDir, { recursive: true })
    }

    return fs.existsSync(executablePath)
  }

  async run(
    _: Electron.IpcMainInvokeEvent,
    cliTool: string,
    _model: string,
    directory: string,
    env: Record<string, string>
  ) {
    const packageName = await this.getPackageName(cliTool)
    const bunPath = await this.getBunPath()
    const executableName = await this.getCliExecutableName(cliTool)
    const binDir = path.join(os.homedir(), '.cherrystudio', 'bin')
    const executablePath = path.join(binDir, executableName + (process.platform === 'win32' ? '.exe' : ''))

    // Check if package is already installed
    const isInstalled = await this.isPackageInstalled(cliTool)

    // Select different terminal based on operating system
    const platform = process.platform
    let terminalCommand: string
    let terminalArgs: string[]

    // Build environment variable prefix (based on platform)
    const buildEnvPrefix = (isWindows: boolean) => {
      if (Object.keys(env).length === 0) return ''

      if (isWindows) {
        // Windows uses set command
        return Object.entries(env)
          .map(([key, value]) => `set "${key}=${value.replace(/"/g, '\\"')}"`)
          .join(' && ')
      } else {
        // Unix-like systems use export command
        return Object.entries(env)
          .map(([key, value]) => `export ${key}="${value.replace(/"/g, '\\"')}"`)
          .join(' && ')
      }
    }

    // Build command to execute
    let baseCommand: string
    const bunInstallPath = path.join(os.homedir(), '.cherrystudio')

    if (isInstalled) {
      // If already installed, run executable directly
      baseCommand = `"${executablePath}"`
    } else {
      // If not installed, install first then run
      const installEnvPrefix =
        platform === 'win32' ? `set "BUN_INSTALL=${bunInstallPath}" &&` : `export BUN_INSTALL="${bunInstallPath}" &&`

      const installCommand = `${installEnvPrefix} "${bunPath}" install -g ${packageName}`
      baseCommand = `echo "Installing ${packageName}..." && ${installCommand} && echo "Installation complete, starting ${cliTool}..." && "${executablePath}"`
    }

    switch (platform) {
      case 'darwin': {
        // macOS - Use osascript to launch terminal and execute command directly, without showing startup command
        const envPrefix = buildEnvPrefix(false)
        const command = envPrefix ? `${envPrefix} && ${baseCommand}` : baseCommand

        terminalCommand = 'osascript'
        terminalArgs = [
          '-e',
          `tell application "Terminal"
  activate
  do script "cd '${directory.replace(/'/g, "\\'")}' && clear && ${command.replace(/"/g, '\\"')}"
end tell`
        ]
        break
      }
      case 'win32': {
        // Windows - Launch terminal and execute command, without showing startup command
        const envPrefix = buildEnvPrefix(true)
        const command = envPrefix ? `${envPrefix} && ${baseCommand}` : baseCommand

        terminalCommand = 'cmd'
        terminalArgs = ['/c', 'start', 'cmd', '/k', `cd /d "${directory}" && cls && ${command}`]
        break
      }
      case 'linux': {
        // Linux - Try to use common terminal emulators
        const envPrefix = buildEnvPrefix(false)
        const command = envPrefix ? `${envPrefix} && ${baseCommand}` : baseCommand

        const linuxTerminals = ['gnome-terminal', 'konsole', 'xterm', 'x-terminal-emulator']
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

    // Launch terminal process
    try {
      spawn(terminalCommand, terminalArgs, {
        detached: true,
        stdio: 'ignore',
        cwd: directory,
        env: { ...process.env, ...env }
      })

      return {
        success: true,
        message: `Launched ${cliTool} in new terminal window`,
        command: `${terminalCommand} ${terminalArgs.join(' ')}`
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return {
        success: false,
        message: `Failed to launch terminal: ${errorMessage}`,
        command: `${terminalCommand} ${terminalArgs.join(' ')}`
      }
    }
  }
}

export const codeToolsService = new CodeToolsService()
