import { loggerService } from '@logger'
import { IpcChannel } from '@shared/IpcChannel'
import Emittery from 'emittery'

import { PocCommandExecution, PocCommandOutput, PocExecuteCommandRequest } from '../pages/command-poc/types'

const logger = loggerService.withContext('AgentCommandService')

/**
 * Events emitted by AgentCommandService
 */
export interface AgentCommandServiceEvents {
  commandOutput: PocCommandOutput
  commandStart: { commandId: string; command: string }
  commandComplete: { commandId: string; exitCode?: number }
  commandError: { commandId: string; error: string }
}

/**
 * AgentCommandService - POC implementation for command execution in the renderer process
 *
 * Features:
 * - Execute commands via IPC to main process
 * - Real-time output streaming from main process
 * - Command interruption support
 * - Event-driven architecture for handling output
 * - Process state tracking
 */
export class AgentCommandService {
  private static instance: AgentCommandService | null = null
  private eventEmitter: Emittery<AgentCommandServiceEvents>
  private runningCommands = new Map<string, PocCommandExecution>()
  private outputListenerRemover: (() => void) | null = null

  private constructor() {
    this.eventEmitter = new Emittery<AgentCommandServiceEvents>()
    this.setupOutputListener()
    logger.info('AgentCommandService initialized')
  }

  public static getInstance(): AgentCommandService {
    if (!AgentCommandService.instance) {
      AgentCommandService.instance = new AgentCommandService()
    }
    return AgentCommandService.instance
  }

  /**
   * Sets up IPC listener for command output from main process
   */
  private setupOutputListener(): void {
    if (this.outputListenerRemover) {
      return
    }

    // Listen for command output from main process
    this.outputListenerRemover = window.electron.ipcRenderer.on(
      IpcChannel.Poc_CommandOutput,
      (_event, output: PocCommandOutput) => {
        this.handleCommandOutput(output)
      }
    )

    logger.debug('Command output listener registered')
  }

  /**
   * Handles command output received from main process
   */
  private handleCommandOutput(output: PocCommandOutput): void {
    const { commandId, type, data, exitCode } = output

    logger.verbose('Received command output', {
      commandId,
      type,
      dataLength: data?.length || 0,
      exitCode
    })

    // Update command execution state
    const command = this.runningCommands.get(commandId)
    if (command) {
      if (type === 'exit') {
        command.isRunning = false
        command.endTime = Date.now()
        command.exitCode = exitCode
        this.eventEmitter.emit('commandComplete', { commandId, exitCode })
      } else if (type === 'error') {
        command.isRunning = false
        command.endTime = Date.now()
        this.eventEmitter.emit('commandError', { commandId, error: data })
      }
    }

    // Emit the output event for consumers
    this.eventEmitter.emit('commandOutput', output)
  }

  /**
   * Executes a command through the main process
   *
   * @param command - The command to execute
   * @param workingDirectory - Working directory for the command
   * @returns Promise that resolves when command starts execution
   */
  public async executeCommand(command: string, workingDirectory: string = process.cwd()): Promise<string> {
    const commandId = `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    logger.info('Executing command', {
      commandId,
      command: command.substring(0, 100) + (command.length > 100 ? '...' : ''),
      workingDirectory
    })

    // Create command execution record
    const commandExecution: PocCommandExecution = {
      id: commandId,
      command,
      startTime: Date.now(),
      isRunning: true
    }

    this.runningCommands.set(commandId, commandExecution)

    // Prepare IPC request
    const request: PocExecuteCommandRequest = {
      id: commandId,
      command,
      workingDirectory
    }

    try {
      // Send command to main process for execution
      await window.api.poc.executeCommand(request)

      // Emit command start event
      this.eventEmitter.emit('commandStart', { commandId, command })

      logger.debug('Command execution started', { commandId })
      return commandId
    } catch (error) {
      // Remove from running commands if failed to start
      this.runningCommands.delete(commandId)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
      logger.error('Failed to execute command', error as Error, { commandId })
      throw new Error(`Failed to execute command: ${errorMessage}`)
    }
  }

  /**
   * Interrupts a running command
   *
   * @param commandId - ID of the command to interrupt
   * @returns Promise that resolves to true if interrupted successfully
   */
  public async interruptCommand(commandId: string): Promise<boolean> {
    logger.info('Interrupting command', { commandId })

    try {
      const result = await window.api.poc.interruptCommand(commandId)

      if (result) {
        const command = this.runningCommands.get(commandId)
        if (command) {
          command.isRunning = false
          command.endTime = Date.now()
        }
        logger.info('Command interrupted successfully', { commandId })
      } else {
        logger.warn('Failed to interrupt command', { commandId })
      }

      return result
    } catch (error) {
      logger.error('Error interrupting command', error as Error, { commandId })
      return false
    }
  }

  /**
   * Gets information about all currently running commands
   *
   * @returns Array of running command executions
   */
  public getRunningCommands(): PocCommandExecution[] {
    return Array.from(this.runningCommands.values()).filter((cmd) => cmd.isRunning)
  }

  /**
   * Gets information about a specific command
   *
   * @param commandId - ID of the command
   * @returns Command execution info or undefined if not found
   */
  public getCommand(commandId: string): PocCommandExecution | undefined {
    return this.runningCommands.get(commandId)
  }

  /**
   * Gets information about all commands (running and completed)
   *
   * @returns Array of all command executions
   */
  public getAllCommands(): PocCommandExecution[] {
    return Array.from(this.runningCommands.values())
  }

  /**
   * Clears completed commands from memory
   */
  public clearCompletedCommands(): void {
    const completedCommands = Array.from(this.runningCommands.entries())
      .filter(([, cmd]) => !cmd.isRunning)
      .map(([id]) => id)

    for (const commandId of completedCommands) {
      this.runningCommands.delete(commandId)
    }

    logger.debug('Cleared completed commands', { count: completedCommands.length })
  }

  /**
   * Registers an event listener for command events
   *
   * @param event - Event name to listen for
   * @param listener - Event handler function
   * @returns Unsubscribe function
   */
  public on<T extends keyof AgentCommandServiceEvents>(
    event: T,
    listener: (data: AgentCommandServiceEvents[T]) => void
  ): () => void {
    this.eventEmitter.on(event, listener)
    return () => this.eventEmitter.off(event, listener)
  }

  /**
   * Registers a one-time event listener for command events
   *
   * @param event - Event name to listen for
   * @returns Promise that resolves when event is emitted
   */
  public once<T extends keyof AgentCommandServiceEvents>(event: T): Promise<AgentCommandServiceEvents[T]> {
    return this.eventEmitter.once(event)
  }

  /**
   * Removes all event listeners and cleans up resources
   */
  public cleanup(): void {
    logger.info('Cleaning up AgentCommandService')

    // Clear all event listeners
    this.eventEmitter.clearListeners()

    // Clear command history
    this.runningCommands.clear()

    // Remove IPC listener
    if (this.outputListenerRemover) {
      this.outputListenerRemover()
      this.outputListenerRemover = null
    }

    logger.info('AgentCommandService cleanup completed')
  }

  /**
   * Gets active processes from the main process
   *
   * @returns Promise that resolves to array of active processes
   */
  public async getActiveProcesses(): Promise<any[]> {
    try {
      return await window.api.poc.getActiveProcesses()
    } catch (error) {
      logger.error('Error getting active processes', error as Error)
      return []
    }
  }
}

// Export singleton instance
export const agentCommandService = AgentCommandService.getInstance()
