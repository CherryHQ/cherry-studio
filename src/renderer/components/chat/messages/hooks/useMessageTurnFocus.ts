import { type FocusEvent, type KeyboardEvent, use, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { loggerService } from '@logger'
import { ContextKeyRegisterContext, useCommandHandler } from '@renderer/hooks/command'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { getComposerTextFromParts } from '@renderer/utils/message/composerTokens'
import type { CherryMessagePart } from '@shared/data/types/message'

import type { MessageListItem } from '../types'

const logger = loggerService.withContext('useMessageTurnFocus')

const INTERACTIVE_TARGET_SELECTOR = 'button,a,summary,input,textarea,select,[role="button"],[contenteditable="true"]'

type Turn = readonly [key: string, messages: readonly MessageListItem[]]

interface UseMessageTurnFocusOptions {
  turns: readonly Turn[]
  getMessageParts: (messageId: string) => CherryMessagePart[]
  scrollToTurn: (key: string) => void
  /** The focused turn is dropped whenever this changes (e.g. switching conversations). */
  resetKey: string
}

/**
 * Keyboard turn selection for a message list. The returned props make the list
 * surface focusable so the navigation commands only apply while focus is inside it.
 */
export function useMessageTurnFocus({ turns, getMessageParts, scrollToTurn, resetKey }: UseMessageTurnFocusOptions) {
  const { t } = useTranslation()
  const registerContextKey = use(ContextKeyRegisterContext)
  const [focusedTurnKey, setFocusedTurnKey] = useState<string | null>(null)
  const [surfaceFocused, setSurfaceFocused] = useState(false)

  useEffect(() => setFocusedTurnKey(null), [resetKey])

  useEffect(() => {
    if (!surfaceFocused) return
    return registerContextKey?.('chat.messages.focused', true)
  }, [registerContextKey, surfaceFocused])

  const moveFocus = (direction: 'next' | 'prev') => {
    const currentIndex = turns.findIndex(([key]) => key === focusedTurnKey)
    const nextIndex =
      currentIndex === -1
        ? direction === 'next'
          ? 0
          : turns.length - 1
        : currentIndex + (direction === 'next' ? 1 : -1)
    const nextTurn = turns[nextIndex]
    if (!nextTurn) return

    setFocusedTurnKey(nextTurn[0])
    scrollToTurn(nextTurn[0])
  }

  useCommandHandler('chat.message.focus_next', () => moveFocus('next'), { enabled: surfaceFocused })
  useCommandHandler('chat.message.focus_prev', () => moveFocus('prev'), { enabled: surfaceFocused })

  const copyFocusedTurn = () => {
    const turn = turns.find(([key]) => key === focusedTurnKey)
    if (!turn) return

    const text = turn[1]
      .filter((message) => !message.isContextBoundary)
      .map((message) => getComposerTextFromParts(getMessageParts(message.id)))
      .filter(Boolean)
      .join('\n\n')
    if (!text) return

    navigator.clipboard
      .writeText(text)
      .then(() => toast.success(t('message.copy.success')))
      .catch((error) => {
        logger.error('Failed to copy focused turn:', error as Error)
        toast.error(formatErrorMessageWithPrefix(error, t('common.copy_failed')))
      })
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!focusedTurnKey || event.nativeEvent.isComposing) return
    if (event.target instanceof Element && event.target.closest(INTERACTIVE_TARGET_SELECTOR)) return

    if (event.key === 'Escape') {
      setFocusedTurnKey(null)
    } else if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      event.preventDefault()
      copyFocusedTurn()
    }
  }

  const handleFocus = useCallback(() => setSurfaceFocused(true), [])
  const handleBlur = useCallback((event: FocusEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setSurfaceFocused(false)
  }, [])

  return {
    focusedTurnKey,
    surfaceProps: { tabIndex: -1, onFocus: handleFocus, onBlur: handleBlur, onKeyDown: handleKeyDown }
  }
}
