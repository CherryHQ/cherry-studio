import { loggerService } from '@logger'
import { useCallback, useEffect, useState } from 'react'

const logger = loggerService.withContext('UseCommandHistory')

const HISTORY_STORAGE_KEY = 'poc-command-history'
const MAX_HISTORY_SIZE = 100

/**
 * Hook for command input history navigation
 *
 * Features:
 * - Navigate previous commands with arrow keys (up/down)
 * - Persistent storage of command history
 * - Automatic deduplication of commands
 * - Maximum history size management
 * - Current input preservation during navigation
 */
export function useCommandHistory() {
  const [history, setHistory] = useState<string[]>([])
  const [currentIndex, setCurrentIndex] = useState(-1)
  const [originalInput, setOriginalInput] = useState('')

  /**
   * Loads command history from localStorage
   */
  const loadHistory = useCallback(() => {
    try {
      const stored = localStorage.getItem(HISTORY_STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        if (Array.isArray(parsed)) {
          setHistory(parsed.slice(-MAX_HISTORY_SIZE)) // Keep only recent commands
          logger.debug('Loaded command history', { count: parsed.length })
        }
      }
    } catch (error) {
      logger.error('Failed to load command history', error as Error)
      setHistory([])
    }
  }, [])

  /**
   * Saves command history to localStorage
   */
  const saveHistory = useCallback((newHistory: string[]) => {
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(newHistory))
      logger.debug('Saved command history', { count: newHistory.length })
    } catch (error) {
      logger.error('Failed to save command history', error as Error)
    }
  }, [])

  /**
   * Adds a command to history
   */
  const addToHistory = useCallback(
    (command: string) => {
      const trimmedCommand = command.trim()
      if (!trimmedCommand) {
        return
      }

      setHistory((prev) => {
        // Remove duplicate if exists
        const filtered = prev.filter((cmd) => cmd !== trimmedCommand)

        // Add new command at the end
        const newHistory = [...filtered, trimmedCommand]

        // Keep only recent commands
        const trimmed = newHistory.slice(-MAX_HISTORY_SIZE)

        // Save to localStorage
        saveHistory(trimmed)

        logger.debug('Added command to history', { command: trimmedCommand.substring(0, 50) })
        return trimmed
      })

      // Reset navigation state
      setCurrentIndex(-1)
      setOriginalInput('')
    },
    [saveHistory]
  )

  /**
   * Navigates to previous command in history
   */
  const navigatePrevious = useCallback(
    (currentInput: string = ''): string | null => {
      if (history.length === 0) {
        return null
      }

      // Store original input if we're starting navigation
      if (currentIndex === -1) {
        setOriginalInput(currentInput)
      }

      const newIndex = Math.min(currentIndex + 1, history.length - 1)
      setCurrentIndex(newIndex)

      const command = history[history.length - 1 - newIndex]
      logger.debug('Navigated to previous command', { index: newIndex, command: command?.substring(0, 50) })

      return command || null
    },
    [history, currentIndex]
  )

  /**
   * Navigates to next command in history
   */
  const navigateNext = useCallback((): string | null => {
    if (currentIndex <= 0) {
      // Return to original input
      setCurrentIndex(-1)
      const result = originalInput
      setOriginalInput('')
      logger.debug('Returned to original input', { input: result.substring(0, 50) })
      return result
    }

    const newIndex = currentIndex - 1
    setCurrentIndex(newIndex)

    const command = history[history.length - 1 - newIndex]
    logger.debug('Navigated to next command', { index: newIndex, command: command?.substring(0, 50) })

    return command || null
  }, [history, currentIndex, originalInput])

  /**
   * Resets navigation state
   */
  const resetNavigation = useCallback(() => {
    setCurrentIndex(-1)
    setOriginalInput('')
    logger.debug('Reset command history navigation')
  }, [])

  /**
   * Gets the current command being navigated
   */
  const getCurrentCommand = useCallback((): string | null => {
    if (currentIndex === -1) {
      return originalInput || null
    }
    return history[history.length - 1 - currentIndex] || null
  }, [history, currentIndex, originalInput])

  /**
   * Clears all command history
   */
  const clearHistory = useCallback(() => {
    setHistory([])
    setCurrentIndex(-1)
    setOriginalInput('')
    localStorage.removeItem(HISTORY_STORAGE_KEY)
    logger.info('Cleared command history')
  }, [])

  /**
   * Gets all history commands (most recent first)
   */
  const getHistory = useCallback((): string[] => {
    return [...history].reverse()
  }, [history])

  /**
   * Checks if currently navigating through history
   */
  const isNavigating = useCallback((): boolean => {
    return currentIndex !== -1
  }, [currentIndex])

  /**
   * Handles keyboard navigation
   */
  const handleKeyNavigation = useCallback(
    (event: KeyboardEvent, currentInput: string = ''): string | null => {
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        return navigatePrevious(currentInput)
      } else if (event.key === 'ArrowDown') {
        event.preventDefault()
        return navigateNext()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        resetNavigation()
        return originalInput || currentInput
      }
      return null
    },
    [navigatePrevious, navigateNext, resetNavigation, originalInput]
  )

  // Load history on mount
  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  return {
    // State
    history: getHistory(),
    isNavigating: isNavigating(),

    // Actions
    addToHistory,
    navigatePrevious,
    navigateNext,
    resetNavigation,
    getCurrentCommand,
    clearHistory,
    handleKeyNavigation
  }
}
