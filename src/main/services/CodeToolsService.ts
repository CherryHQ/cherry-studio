import os from 'node:os'
import path from 'node:path'

import { getBinaryName } from '@main/utils/process'
import { spawn } from 'child_process'

class CodeToolsService {
  constructor() {
    this.getBunPath = this.getBunPath.bind(this)
    this.getPackageName = this.getPackageName.bind(this)
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

  async run(
    _: Electron.IpcMainInvokeEvent,
    cliTool: string,
    _model: string,
    directory: string,
    env: Record<string, string>
  ) {
    const packageName = await this.getPackageName(cliTool)
    const bunPath = await this.getBunPath()

    // 根据操作系统选择不同的终端
    const platform = process.platform
    let terminalCommand: string
    let terminalArgs: string[]

    // 构建环境变量前缀（根据平台不同）
    const buildEnvPrefix = (isWindows: boolean) => {
      if (Object.keys(env).length === 0) return ''

      if (isWindows) {
        // Windows 使用 set 命令
        return Object.entries(env)
          .map(([key, value]) => `set "${key}=${value.replace(/"/g, '\\"')}"`)
          .join(' && ')
      } else {
        // Unix-like 系统使用 export 命令
        return Object.entries(env)
          .map(([key, value]) => `export ${key}="${value.replace(/"/g, '\\"')}"`)
          .join(' && ')
      }
    }

    // 构建要执行的命令
    const baseCommand = `"${bunPath}" x ${packageName}`

    switch (platform) {
      case 'darwin': {
        // macOS - 直接使用 osascript 启动终端并执行命令，不显示启动命令
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
        // Windows - 启动终端并执行命令，不显示启动命令
        const envPrefix = buildEnvPrefix(true)
        const command = envPrefix ? `${envPrefix} && ${baseCommand}` : baseCommand

        terminalCommand = 'cmd'
        terminalArgs = ['/c', 'start', 'cmd', '/k', `cd /d "${directory}" && cls && ${command}`]
        break
      }
      case 'linux': {
        // Linux - 尝试使用常见的终端模拟器
        const envPrefix = buildEnvPrefix(false)
        const command = envPrefix ? `${envPrefix} && ${baseCommand}` : baseCommand

        const linuxTerminals = ['gnome-terminal', 'konsole', 'xterm', 'x-terminal-emulator']
        let foundTerminal = 'xterm' // 默认使用 xterm

        for (const terminal of linuxTerminals) {
          try {
            // 检查终端是否存在
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
            // 继续尝试下一个终端
          }
        }

        if (foundTerminal === 'gnome-terminal') {
          terminalCommand = 'gnome-terminal'
          terminalArgs = ['--working-directory', directory, '--', 'bash', '-c', `clear && ${command}; exec bash`]
        } else if (foundTerminal === 'konsole') {
          terminalCommand = 'konsole'
          terminalArgs = ['--workdir', directory, '-e', 'bash', '-c', `clear && ${command}; exec bash`]
        } else {
          // 默认使用 xterm
          terminalCommand = 'xterm'
          terminalArgs = ['-e', `cd "${directory}" && clear && ${command} && bash`]
        }
        break
      }
      default:
        throw new Error(`不支持的操作系统: ${platform}`)
    }

    // 启动终端进程
    try {
      spawn(terminalCommand, terminalArgs, {
        detached: true,
        stdio: 'ignore',
        cwd: directory,
        env: { ...process.env, ...env }
      })

      return {
        success: true,
        message: `已在新终端窗口中启动 ${cliTool}`,
        command: `${terminalCommand} ${terminalArgs.join(' ')}`
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return {
        success: false,
        message: `启动终端失败: ${errorMessage}`,
        command: `${terminalCommand} ${terminalArgs.join(' ')}`
      }
    }
  }
}

export const codeToolsService = new CodeToolsService()
