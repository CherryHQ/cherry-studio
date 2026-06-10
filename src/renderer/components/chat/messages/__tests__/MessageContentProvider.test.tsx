import type { CherryMessagePart } from '@shared/data/types/message'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { useMessageParts } from '../blocks'
import { MessageContentProvider } from '../MessageContentProvider'
import {
  useMessageListActions,
  useMessageListData,
  useMessageListMeta,
  useMessageListSelection,
  useMessageRenderConfig
} from '../MessageListProvider'
import type { MessageListItem } from '../types'
import { defaultMessageRenderConfig } from '../types'

const message: MessageListItem = {
  id: 'message-standalone',
  role: 'assistant',
  topicId: 'topic-standalone',
  assistantId: 'assistant-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  status: 'pending'
}

const part: CherryMessagePart = { type: 'text', text: 'standalone' } as CherryMessagePart

describe('MessageContentProvider', () => {
  it('creates a standalone message provider value from content props', () => {
    const locateMessage = vi.fn()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MessageContentProvider
        messages={[message]}
        partsByMessageId={{ [message.id]: [part] }}
        actions={{ locateMessage }}
        renderConfig={{ fontSize: 16, messageStyle: 'plain' }}>
        {children}
      </MessageContentProvider>
    )

    const { result } = renderHook(
      () => ({
        data: useMessageListData(),
        actions: useMessageListActions(),
        meta: useMessageListMeta(),
        selection: useMessageListSelection(),
        renderConfig: useMessageRenderConfig(),
        parts: useMessageParts(message.id)
      }),
      { wrapper }
    )

    expect(result.current.data.topic.id).toBe(message.topicId)
    expect(result.current.data.messages).toEqual([message])
    expect(result.current.actions.locateMessage).toBe(locateMessage)
    expect(result.current.meta.selectionLayer).toBe(false)
    expect(result.current.selection).toEqual({
      enabled: false,
      isMultiSelectMode: false,
      selectedMessageIds: []
    })
    expect(result.current.renderConfig).toEqual({
      ...defaultMessageRenderConfig,
      fontSize: 16,
      messageStyle: 'plain'
    })
    expect(result.current.parts).toEqual([part])
  })
})
