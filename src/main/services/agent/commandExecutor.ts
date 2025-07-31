import { ChildProcess, spawn } from 'node:child_process'

import { loggerService } from '@logger'
import { isWin } from '@main/constant'
import getLoginShellEnvironment from '@main/utils/shell-env'
import { IpcChannel } from '@shared/IpcChannel'
import { PocCommandOutput, PocExecuteCommandRequest } from '@types'
import { BrowserWindow } from 'electron'

const logger = loggerService.withContext('PocCommandExecutor')

export interface PocRunningProcess {
  id: string
  command: string
  childProcess: ChildProcess
  workingDirectory: string
  startTime: number
}

/**
 * ShellCommandExecutor - POC implementation for cross-platform command execution
 *
 * Features:
 * - Cross-platform shell detection (cmd on Windows, bash on Unix-like systems)
 * - Real-time stdout/stderr streaming via IPC
 * - Process management with activeProcesses Map
 * - Command interruption support
 * - Proper error handling and process cleanup
 */
export class ShellCommandExecutor {
  private static instance: ShellCommandExecutor | null = null
  private mainWindow: BrowserWindow | null = null
  private activeProcesses = new Map<string, PocRunningProcess>()

  private constructor() {
    // Private constructor for singleton pattern
    logger.info('PocCommandExecutor initialized')
  }

  public static getInstance(): ShellCommandExecutor {
    if (!ShellCommandExecutor.instance) {
      ShellCommandExecutor.instance = new ShellCommandExecutor()
    }
    return ShellCommandExecutor.instance
  }

  public setMainWindow(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow
    logger.info('Main window set for PocCommandExecutor')
  }

  /**
   * Detects the appropriate shell for the current platform
   */
  private getShellCommand(): { shell: string; args: string[] } {
    if (isWin) {
      // Windows: Use cmd.exe with /c flag
      return {
        shell: 'cmd.exe',
        args: ['/c']
      }
    } else {
      // Unix-like systems: Use bash with -c flag
      return {
        shell: 'bash',
        args: ['-c']
      }
    }
  }

  /**
   * Executes a command and streams output to the renderer process
   */
  public async executeCommand(request: PocExecuteCommandRequest): Promise<void> {
    if (!this.mainWindow) {
      throw new Error('Main window not set in PocCommandExecutor')
    }

    const { id, command, workingDirectory } = request

    logger.info('Executing command', {
      commandId: id,
      command: command.substring(0, 100) + (command.length > 100 ? '...' : ''),
      workingDirectory
    })

    try {
      const { shell, args } = this.getShellCommand()
      const fullArgs = [...args, command]
      // load login shell environment
      const loginEnv = await getLoginShellEnvironment()

      // Spawn the child process
      const childProcess = spawn(shell, fullArgs, {
        cwd: workingDirectory,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...loginEnv,
          // Ensure UTF-8 encoding on Windows
          ...(isWin ? { CHCP: '65001' } : {})
        }
      })

      // Store the running process
      const runningProcess: PocRunningProcess = {
        id,
        command,
        childProcess,
        workingDirectory,
        startTime: Date.now()
      }
      this.activeProcesses.set(id, runningProcess)

      // Handle stdout data
      childProcess.stdout?.on('data', (data: Buffer) => {
        const output = data.toString('utf8')
        this.sendOutput(id, 'stdout', output)
        logger.verbose('Command stdout', { commandId: id, output: output.substring(0, 200) })
      })

      // Handle stderr data
      childProcess.stderr?.on('data', (data: Buffer) => {
        const output = data.toString('utf8')
        this.sendOutput(id, 'stderr', output)
        logger.verbose('Command stderr', { commandId: id, output: output.substring(0, 200) })
      })

      // Handle process exit
      childProcess.on('exit', (code: number | null, signal: string | null) => {
        const exitCode = code ?? (signal ? -1 : 0)
        this.sendOutput(id, 'exit', '', exitCode)
        this.activeProcesses.delete(id)

        logger.info('Command completed', {
          commandId: id,
          exitCode,
          signal,
          duration: Date.now() - runningProcess.startTime
        })
      })

      // Handle process errors
      childProcess.on('error', (error: Error) => {
        this.sendOutput(id, 'error', error.message)
        this.activeProcesses.delete(id)

        logger.error('Command execution error', error, { commandId: id })
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
      this.sendOutput(id, 'error', errorMessage)
      this.activeProcesses.delete(id)

      logger.error('Failed to execute command', error as Error, { commandId: id })
    }
  }

  /**
   * Interrupts a running command by its ID
   */
  public interruptCommand(commandId: string): boolean {
    const runningProcess = this.activeProcesses.get(commandId)

    if (!runningProcess) {
      logger.warn('Attempted to interrupt non-existent command', { commandId })
      return false
    }

    try {
      // Try graceful termination first
      const killed = runningProcess.childProcess.kill('SIGTERM')

      if (killed) {
        logger.info('Command interrupted', { commandId })

        // Force kill after 5 seconds if process doesn't exit gracefully
        setTimeout(() => {
          if (this.activeProcesses.has(commandId)) {
            runningProcess.childProcess.kill('SIGKILL')
            this.activeProcesses.delete(commandId)
            logger.info('Command force killed', { commandId })
          }
        }, 5000)

        return true
      } else {
        logger.warn('Failed to interrupt command', { commandId })
        return false
      }
    } catch (error) {
      logger.error('Error interrupting command', error as Error, { commandId })
      return false
    }
  }

  /**
   * Gets information about all currently running processes
   */
  public getActiveProcesses(): PocRunningProcess[] {
    return Array.from(this.activeProcesses.values()).map((proc) => ({
      ...proc,
      // Don't expose the actual ChildProcess object
      childProcess: undefined as any
    }))
  }

  /**
   * Cleans up all active processes (typically called on app shutdown)
   */
  public cleanup(): void {
    logger.info('Cleaning up active processes', { count: this.activeProcesses.size })

    for (const [commandId, runningProcess] of this.activeProcesses) {
      try {
        runningProcess.childProcess.kill('SIGTERM')
        logger.info('Terminated process during cleanup', { commandId })
      } catch (error) {
        logger.error('Error terminating process during cleanup', error as Error, { commandId })
      }
    }

    this.activeProcesses.clear()
  }

  /**
   * Sends command output to the renderer process via IPC
   */
  private sendOutput(commandId: string, type: PocCommandOutput['type'], data: string, exitCode?: number): void {
    if (!this.mainWindow) {
      logger.warn('Cannot send output - main window not set')
      return
    }

    const output: PocCommandOutput = {
      commandId,
      type,
      data,
      ...(exitCode !== undefined && { exitCode })
    }

    this.mainWindow.webContents.send(IpcChannel.Poc_CommandOutput, output)
  }
}

export const pocCommandExecutor = ShellCommandExecutor.getInstance()
