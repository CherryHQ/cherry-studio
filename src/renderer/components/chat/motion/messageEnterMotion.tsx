import type { ChatMessageStyle } from '@shared/data/preference/preferenceTypes'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { ReactNode } from 'react'
import { createContext, use, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import type { MessageListItem } from '../messages/types'

const EMPTY_MESSAGE_ID_SET = new Set<string>()
const MESSAGE_ENTER_MOTION_CLEAR_DELAY_MS = 380

export type MessageEnterMotionVariant = 'user-inline' | 'user-bubble' | 'assistant'

interface MessageEnterMotionContextValue {
  state: {
    enteringMessageIds: ReadonlySet<string>
  }
}

const MessageEnterMotionContext = createContext<MessageEnterMotionContextValue | null>(null)

export function MessageEnterMotionProvider({
  enteringMessageIds,
  children
}: {
  enteringMessageIds: ReadonlySet<string>
  children: ReactNode
}) {
  const value = useMemo<MessageEnterMotionContextValue>(
    () => ({
      state: {
        enteringMessageIds
      }
    }),
    [enteringMessageIds]
  )

  return <MessageEnterMotionContext value={value}>{children}</MessageEnterMotionContext>
}

export function useMessageEnterMotionActive(messageId: string): boolean {
  return use(MessageEnterMotionContext)?.state.enteringMessageIds.has(messageId) ?? false
}

export function useMessageEnterMotionIds({
  messages,
  scopeKey
}: {
  messages: readonly MessageListItem[]
  scopeKey: string
}): ReadonlySet<string> {
  const knownMessageIdsRef = useRef<Set<string> | null>(null)
  const scopeKeyRef = useRef(scopeKey)
  const enteringMessageIdsRef = useRef<ReadonlySet<string>>(EMPTY_MESSAGE_ID_SET)
  const [enteringMessageIds, setEnteringMessageIds] = useState<ReadonlySet<string>>(EMPTY_MESSAGE_ID_SET)

  useLayoutEffect(() => {
    const nextKnownMessageIds = new Set(messages.map((message) => message.id))

    if (knownMessageIdsRef.current === null || scopeKeyRef.current !== scopeKey) {
      knownMessageIdsRef.current = nextKnownMessageIds
      scopeKeyRef.current = scopeKey
      if (enteringMessageIdsRef.current.size > 0) {
        enteringMessageIdsRef.current = EMPTY_MESSAGE_ID_SET
        setEnteringMessageIds(EMPTY_MESSAGE_ID_SET)
      }
      return
    }

    const previousMessageIds = knownMessageIdsRef.current
    const nextEnteringIds = messages
      .filter(
        (message) =>
          (message.role === 'user' || message.role === 'assistant') &&
          message.type !== 'clear' &&
          !previousMessageIds.has(message.id)
      )
      .map((message) => message.id)

    knownMessageIdsRef.current = nextKnownMessageIds

    if (nextEnteringIds.length === 0) {
      return
    }

    const nextEnteringMessageIds = new Set(nextEnteringIds)
    enteringMessageIdsRef.current = nextEnteringMessageIds
    setEnteringMessageIds(nextEnteringMessageIds)
  }, [messages, scopeKey])

  useEffect(() => {
    if (enteringMessageIds.size === 0) return

    const timer = window.setTimeout(() => {
      enteringMessageIdsRef.current = EMPTY_MESSAGE_ID_SET
      setEnteringMessageIds(EMPTY_MESSAGE_ID_SET)
    }, MESSAGE_ENTER_MOTION_CLEAR_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [enteringMessageIds])

  return enteringMessageIds
}

export function getMessageEnterMotionVariant({
  active,
  role,
  messageStyle,
  isMultiSelectMode
}: {
  active: boolean
  role: CherryUIMessage['role']
  messageStyle: ChatMessageStyle
  isMultiSelectMode: boolean
}): MessageEnterMotionVariant | undefined {
  if (!active || isMultiSelectMode) return undefined
  if (role === 'user') return messageStyle === 'bubble' ? 'user-bubble' : 'user-inline'
  if (role === 'assistant') return 'assistant'
  return undefined
}

const MESSAGE_ENTER_MOTION_CLASS: Record<MessageEnterMotionVariant, string> = {
  'user-inline': 'animation-chat-message-enter-inline',
  'user-bubble': 'animation-chat-message-enter-bubble',
  assistant: 'animation-chat-message-enter-assistant'
}

export function getMessageEnterMotionAttributes(variant: MessageEnterMotionVariant | undefined):
  | {
      className: string
      motion: MessageEnterMotionVariant
    }
  | undefined {
  if (!variant) return undefined

  return {
    className: MESSAGE_ENTER_MOTION_CLASS[variant],
    motion: variant
  }
}
