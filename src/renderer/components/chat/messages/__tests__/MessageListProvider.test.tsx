import type { Topic } from '@renderer/types'
import type { CherryMessagePart } from '@shared/data/types/message'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { useMessageParts } from '../blocks'
import {
  MessageListProvider,
  useMessageListActions,
  useMessageListData,
  useMessageListMessages,
  useMessageListMeta,
  useMessageListSelection,
  useMessageListUi,
  useMessageListUiSelectors,
  useMessageListUiStatic,
  useMessageRenderConfig
} from '../MessageListProvider'
import type { MessageListItem, MessageListProviderValue } from '../types'
import { defaultMessageRenderConfig } from '../types'

const topic: Topic = {
  id: 'topic-1',
  assistantId: 'assistant-1',
  name: 'Topic',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  messages: []
} as Topic

const message: MessageListItem = {
  id: 'message-1',
  role: 'assistant',
  topicId: topic.id,
  assistantId: topic.assistantId,
  createdAt: '2026-01-01T00:00:00.000Z',
  status: 'success'
}

const part: CherryMessagePart = { type: 'text', text: 'hello' } as CherryMessagePart

const createProviderValue = (): MessageListProviderValue => {
  const locateMessage = vi.fn()
  const getMessageUiState = vi.fn(() => ({ useful: true }))

  return {
    state: {
      topic,
      messages: [message],
      partsByMessageId: {
        [message.id]: [part]
      },
      beforeList: <div />,
      isInitialLoading: false,
      hasOlder: true,
      messageNavigation: 'bottom',
      estimateSize: 64,
      overscan: 6,
      loadOlderDelayMs: 100,
      loadingResetDelayMs: 200,
      listKey: 'topic-1:list',
      readonly: true,
      renderConfig: defaultMessageRenderConfig,
      selection: {
        enabled: true,
        isMultiSelectMode: true,
        selectedMessageIds: [message.id]
      },
      menuConfig: {
        confirmDeleteMessage: true,
        enableDeveloperMode: true,
        exportMenuOptions: {
          image: true,
          markdown: false,
          markdown_reason: false,
          notion: false,
          yuque: false,
          joplin: false,
          obsidian: false,
          siyuan: false,
          docx: false,
          plain_text: false
        }
      },
      translationLanguages: [],
      externalCodeEditors: [],
      getMessageUiState
    },
    actions: {
      locateMessage
    },
    meta: {
      selectionLayer: true,
      imageExportFileName: 'topic-1.png'
    }
  }
}

describe('MessageListProvider', () => {
  it('exposes split provider contexts through hooks', () => {
    const value = createProviderValue()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MessageListProvider value={value}>{children}</MessageListProvider>
    )

    const { result } = renderHook(
      () => ({
        data: useMessageListData(),
        messages: useMessageListMessages(),
        actions: useMessageListActions(),
        meta: useMessageListMeta(),
        renderConfig: useMessageRenderConfig(),
        selection: useMessageListSelection(),
        ui: useMessageListUi(),
        uiStatic: useMessageListUiStatic(),
        uiSelectors: useMessageListUiSelectors(),
        parts: useMessageParts(message.id)
      }),
      { wrapper }
    )

    expect(result.current.data.topic).toBe(topic)
    expect(result.current.data.messages).toEqual([message])
    expect(result.current.messages).toEqual([message])
    expect(result.current.actions.locateMessage).toBe(value.actions.locateMessage)
    expect(result.current.meta.selectionLayer).toBe(true)
    expect(result.current.renderConfig).toBe(defaultMessageRenderConfig)
    expect(result.current.selection?.selectedMessageIds).toEqual([message.id])
    expect(result.current.ui.readonly).toBe(true)
    expect(result.current.uiStatic.readonly).toBe(true)
    expect(result.current.uiSelectors.getMessageUiState?.(message.id)).toEqual({ useful: true })
    expect(result.current.parts).toEqual([part])
  })

  it('throws required hooks outside the provider', () => {
    expect(() => renderHook(() => useMessageListActions())).toThrow(
      'useMessageListActions must be used within MessageListProvider'
    )
    expect(() => renderHook(() => useMessageRenderConfig())).toThrow(
      'useMessageRenderConfig must be used within MessageListProvider'
    )
  })
})
