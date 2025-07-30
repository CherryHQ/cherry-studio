import { loggerService } from '@logger'
import type { PocCommandExecution } from '@renderer/pages/command-poc/types'
import { agentCommandService } from '@renderer/services/AgentCommandService'
import { useCallback, useEffect, useRef, useState } from 'react'

const logger = loggerService.withContext('UsePocCommand')

/**
 * Hook for command execution logic with output buffering
 *
 * Features:
 * - Command execution with status tracking
 * - Real-time output streaming with 100ms debounce buffering
 * - Command interruption support
 * - Process state management
 * - Error handling and cleanup
 */
export function usePocCommand() {
  const [isExecuting, setIsExecuting] = useState(false)
  const [currentCommandId, setCurrentCommandId] = useState<string | null>(null)
  const [runningCommands, setRunningCommands] = useState<PocCommandExecution[]>([])

  // Output buffering with debounce
  const outputBuffer = useRef<Map<string, string>>(new Map())
  const bufferTimeouts = useRef<Map<string, NodeJS.Timeout>>(new Map())
  const onOutputCallbackRef = useRef<((commandId: string, output: string, isBuffered: boolean) => void) | null>(null)

  /**
   * Sets the callback for handling buffered output
   */
  const setOutputCallback = useCallback(
    (callback: (commandId: string, output: string, isBuffered: boolean) => void) => {
      onOutputCallbackRef.current = callback
    },
    []
  )

  /**
   * Flushes buffered output for a command
   */
  const flushBuffer = useCallback((commandId: string) => {
    const bufferedOutput = outputBuffer.current.get(commandId)
    if (bufferedOutput && onOutputCallbackRef.current) {
      onOutputCallbackRef.current(commandId, bufferedOutput, true)
      outputBuffer.current.delete(commandId)

      // Clear any pending timeout
      const timeout = bufferTimeouts.current.get(commandId)
      if (timeout) {
        clearTimeout(timeout)
        bufferTimeouts.current.delete(commandId)
      }
    }
  }, [])

  /**
   * Buffers output with 100ms debounce
   */
  const bufferOutput = useCallback(
    (commandId: string, output: string) => {
      // Add to buffer
      const current = outputBuffer.current.get(commandId) || ''
      outputBuffer.current.set(commandId, current + output)

      // Clear existing timeout
      const existingTimeout = bufferTimeouts.current.get(commandId)
      if (existingTimeout) {
        clearTimeout(existingTimeout)
      }

      // Set new timeout for flushing
      const timeout = setTimeout(() => {
        flushBuffer(commandId)
      }, 100) // 100ms debounce as specified in PRD

      bufferTimeouts.current.set(commandId, timeout)
    },
    [flushBuffer]
  )

  /**
   * Executes a command
   */
  const executeCommand = useCallback(
    async (command: string, workingDirectory?: string): Promise<string | null> => {
      if (isExecuting) {
        logger.warn('Cannot execute command: another command is already running')
        return null
      }

      try {
        setIsExecuting(true)
        logger.info('Executing command', { command: command.substring(0, 100) })

        const commandId = await agentCommandService.executeCommand(command, workingDirectory)
        setCurrentCommandId(commandId)

        logger.debug('Command execution started', { commandId })
        return commandId
      } catch (error) {
        logger.error('Failed to execute command', error as Error)
        setIsExecuting(false)
        setCurrentCommandId(null)
        return null
      }
    },
    [isExecuting]
  )

  /**
   * Interrupts the current command
   */
  const interruptCommand = useCallback(
    async (commandId?: string): Promise<boolean> => {
      const targetCommandId = commandId || currentCommandId
      if (!targetCommandId) {
        logger.warn('No command to interrupt')
        return false
      }

      try {
        logger.info('Interrupting command', { commandId: targetCommandId })
        const result = await agentCommandService.interruptCommand(targetCommandId)

        if (result) {
          // Flush any remaining buffered output
          flushBuffer(targetCommandId)

          if (targetCommandId === currentCommandId) {
            setIsExecuting(false)
            setCurrentCommandId(null)
          }
        }

        return result
      } catch (error) {
        logger.error('Failed to interrupt command', error as Error)
        return false
      }
    },
    [currentCommandId, flushBuffer]
  )

  /**
   * Gets information about a specific command
   */
  const getCommandInfo = useCallback((commandId: string): PocCommandExecution | undefined => {
    return agentCommandService.getCommand(commandId)
  }, [])

  /**
   * Gets all running commands
   */
  const getRunningCommands = useCallback((): PocCommandExecution[] => {
    return agentCommandService.getRunningCommands()
  }, [])

  /**
   * Clears completed commands from memory
   */
  const clearCompletedCommands = useCallback(() => {
    agentCommandService.clearCompletedCommands()
    setRunningCommands(getRunningCommands())
  }, [getRunningCommands])

  // Set up event listeners for command state updates
  useEffect(() => {
    logger.debug('Setting up command state event listeners')

    // Capture refs for cleanup
    const timeoutsRef = bufferTimeouts.current
    const bufferRef = outputBuffer.current

    // Handle command start
    const unsubscribeStart = agentCommandService.on('commandStart', ({ commandId }) => {
      setRunningCommands((prev) => {
        const command = agentCommandService.getCommand(commandId)
        if (command && !prev.find((c) => c.id === commandId)) {
          return [...prev, command]
        }
        return prev
      })
    })

    // Handle command output with buffering
    const unsubscribeOutput = agentCommandService.on('commandOutput', (output) => {
      const { commandId, type, data } = output

      if (type === 'stdout' || type === 'stderr') {
        // Buffer the output with debounce
        bufferOutput(commandId, data)
      } else if (type === 'exit' || type === 'error') {
        // Flush buffer immediately on command completion
        flushBuffer(commandId)
      }
    })

    // Handle command completion
    const unsubscribeComplete = agentCommandService.on('commandComplete', ({ commandId }) => {
      logger.debug('Command completed', { commandId })

      // Flush any remaining buffered output
      flushBuffer(commandId)

      if (commandId === currentCommandId) {
        setIsExecuting(false)
        setCurrentCommandId(null)
      }

      // Update running commands list
      setRunningCommands(getRunningCommands())
    })

    // Handle command errors
    const unsubscribeError = agentCommandService.on('commandError', ({ commandId }) => {
      logger.debug('Command error occurred', { commandId })

      // Flush any remaining buffered output
      flushBuffer(commandId)

      if (commandId === currentCommandId) {
        setIsExecuting(false)
        setCurrentCommandId(null)
      }

      // Update running commands list
      setRunningCommands(getRunningCommands())
    })

    // Initial load of running commands
    setRunningCommands(getRunningCommands())

    // Cleanup on unmount
    return () => {
      logger.debug('Cleaning up command state event listeners')

      // Clear all buffer timeouts using captured ref
      for (const timeout of timeoutsRef.values()) {
        clearTimeout(timeout)
      }
      timeoutsRef.clear()
      bufferRef.clear()

      unsubscribeStart()
      unsubscribeOutput()
      unsubscribeComplete()
      unsubscribeError()
    }
  }, [currentCommandId, bufferOutput, flushBuffer, getRunningCommands])

  return {
    // State
    isExecuting,
    currentCommandId,
    runningCommands,

    // Actions
    executeCommand,
    interruptCommand,
    getCommandInfo,
    getRunningCommands,
    clearCompletedCommands,
    setOutputCallback,

    // Buffer management
    flushBuffer
  }
}
