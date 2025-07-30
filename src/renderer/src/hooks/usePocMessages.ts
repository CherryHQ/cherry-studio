import { loggerService } from '@logger'
import type { PocMessage } from '@renderer/pages/command-poc/types'
import { agentCommandService } from '@renderer/services/AgentCommandService'
import { useCallback, useEffect, useState } from 'react'

const logger = loggerService.withContext('UsePocMessages')

/**
 * Hook for managing PoC command messages state
 *
 * Features:
 * - Manages list of messages (user commands, output, errors)
 * - Adds user commands with proper timestamps
 * - Appends streaming output from command execution
 * - Handles message completion status
 * - Real-time updates from AgentCommandService events
 */
export function usePocMessages() {
  const [messages, setMessages] = useState<PocMessage[]>([])

  /**
   * Adds a user command message to the list
   */
  const addUserCommand = useCallback((command: string, commandId: string) => {
    const message: PocMessage = {
      id: `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'user-command',
      content: command,
      timestamp: Date.now(),
      commandId,
      isComplete: true
    }

    setMessages((prev) => [...prev, message])
    logger.debug('Added user command message', { commandId, command: command.substring(0, 50) })
  }, [])

  /**
   * Appends streaming output to existing message or creates new one
   */
  const appendOutput = useCallback(
    (commandId: string, content: string, type: 'output' | 'error' = 'output', isComplete: boolean = false) => {
      setMessages((prev) => {
        // Find existing output message for this command
        const existingIndex = prev.findIndex(
          (msg) => msg.commandId === commandId && msg.type === type && !msg.isComplete
        )

        if (existingIndex >= 0) {
          // Update existing message
          const updated = [...prev]
          updated[existingIndex] = {
            ...updated[existingIndex],
            content: updated[existingIndex].content + content,
            isComplete,
            timestamp: Date.now()
          }
          return updated
        } else {
          // Create new output message
          const message: PocMessage = {
            id: `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type,
            content,
            timestamp: Date.now(),
            commandId,
            isComplete
          }
          return [...prev, message]
        }
      })

      logger.verbose('Appended output', {
        commandId,
        type,
        contentLength: content.length,
        isComplete
      })
    },
    []
  )

  /**
   * Marks a message as complete (stops streaming)
   */
  const completeMessage = useCallback((commandId: string, type: 'output' | 'error' = 'output') => {
    setMessages((prev) =>
      prev.map((msg) =>
        msg.commandId === commandId && msg.type === type ? { ...msg, isComplete: true, timestamp: Date.now() } : msg
      )
    )
    logger.debug('Completed message', { commandId, type })
  }, [])

  /**
   * Adds a system message (e.g., command completion notifications)
   */
  const addSystemMessage = useCallback((content: string, commandId?: string) => {
    const message: PocMessage = {
      id: `system_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'system',
      content,
      timestamp: Date.now(),
      commandId,
      isComplete: true
    }

    setMessages((prev) => [...prev, message])
    logger.debug('Added system message', { content, commandId })
  }, [])

  /**
   * Clears all messages
   */
  const clearMessages = useCallback(() => {
    setMessages([])
    logger.info('Cleared all messages')
  }, [])

  /**
   * Gets messages for a specific command
   */
  const getMessagesForCommand = useCallback(
    (commandId: string): PocMessage[] => {
      return messages.filter((msg) => msg.commandId === commandId)
    },
    [messages]
  )

  /**
   * Gets the latest incomplete output message for a command
   */
  const getStreamingMessage = useCallback(
    (commandId: string, type: 'output' | 'error' = 'output'): PocMessage | undefined => {
      return messages.find((msg) => msg.commandId === commandId && msg.type === type && !msg.isComplete)
    },
    [messages]
  )

  // Set up event listeners for AgentCommandService
  useEffect(() => {
    logger.debug('Setting up AgentCommandService event listeners')

    // Handle command output
    const unsubscribeOutput = agentCommandService.on('commandOutput', (output) => {
      const { commandId, type, data } = output

      if (type === 'stdout' || type === 'stderr') {
        const messageType = type === 'stderr' ? 'error' : 'output'
        appendOutput(commandId, data, messageType, false)
      } else if (type === 'exit') {
        // Complete any streaming messages when command exits
        completeMessage(commandId, 'output')
        completeMessage(commandId, 'error')

        // Add system message for command completion
        const exitCode = output.exitCode ?? 0
        const statusMessage = exitCode === 0 ? 'Command completed successfully' : `Command exited with code ${exitCode}`
        addSystemMessage(statusMessage, commandId)
      } else if (type === 'error') {
        appendOutput(commandId, data, 'error', true)
      }
    })

    // Handle command errors
    const unsubscribeError = agentCommandService.on('commandError', ({ commandId, error }) => {
      addSystemMessage(`Command error: ${error}`, commandId)
    })

    // Cleanup on unmount
    return () => {
      logger.debug('Cleaning up AgentCommandService event listeners')
      unsubscribeOutput()
      unsubscribeError()
    }
  }, [appendOutput, completeMessage, addSystemMessage])

  return {
    messages,
    addUserCommand,
    appendOutput,
    completeMessage,
    addSystemMessage,
    clearMessages,
    getMessagesForCommand,
    getStreamingMessage
  }
}
