import type { MessageListProviderValue, MessageListRuntime } from '@renderer/components/chat/messages/types'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { act, render, waitFor } from '@testing-library/react'
import { type ReactNode, useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const eventMocks = vi.hoisted(() => ({
  emit: vi.fn(),
  on: vi.fn(() => vi.fn())
}))

const exportActionsMock = vi.hoisted(() => ({
  saveTextFile: vi.fn(),
  saveImage: vi.fn()
}))

const leafCapabilitiesMock = vi.hoisted(() => ({
  copyImage: vi.fn()
}))

const chatWriteMock = vi.hoisted(() => ({
  editMessage: vi.fn(),
  setActiveNode: vi.fn()
}))

const commandHandlerMock = vi.hoisted(() => vi.fn())
const modelSelectorMock = vi.hoisted(() => ({
  props: [] as any[]
}))

vi.mock('@data/DataApiService', () => ({
  dataApiService: {
    get: vi.fn(),
    patch: vi.fn()
  }
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => {
    if (key === 'chat.message.navigation_mode') return ['anchor', vi.fn()]
    if (key === 'chat.input.translate.target_language') return ['en-us', vi.fn()]
    if (key === 'chat.input.translate.show_confirm') return [false, vi.fn()]
    return [undefined, vi.fn()]
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('@renderer/components/chat/messages/blocks/MessagePartsContext', () => ({
  resolvePartFromParts: vi.fn(() => undefined)
}))

vi.mock('@renderer/components/chat/messages/utils/messageListItem', () => ({
  getMessageListItemModel: vi.fn(() => undefined),
  toMessageListItem: vi.fn((message) => message)
}))

vi.mock('@renderer/components/ModelSelector', () => ({
  ModelSelector: (props: { trigger: ReactNode }) => {
    modelSelectorMock.props.push(props)
    return <>{props.trigger}</>
  }
}))

vi.mock('@renderer/utils/model', () => ({
  isVisionModel: vi.fn(() => false)
}))

vi.mock('@renderer/components/chat/editing/MessageEditingContext', () => ({
  useMessageEditing: () => ({ editingMessageId: null, editingMessage: null, startEditing: vi.fn() })
}))

vi.mock('@renderer/hooks/chat/ChatWriteContext', () => ({
  useChatWrite: () => chatWriteMock
}))

vi.mock('@renderer/hooks/command', () => ({
  useCommandHandler: commandHandlerMock
}))

vi.mock('@renderer/hooks/translate', () => ({
  useLanguages: () => ({
    languages: [],
    getLabel: vi.fn(() => '')
  })
}))

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistant: () => ({
    assistant: { id: 'assistant-1', name: 'Assistant' },
    model: undefined
  })
}))

vi.mock('@renderer/components/chat/messages/hooks/useMessageActivityState', () => ({
  useMessageActivityState: () => vi.fn(() => undefined)
}))

vi.mock('@renderer/components/chat/messages/hooks/useMessageErrorActions', () => ({
  useMessageErrorActions: () => ({})
}))

vi.mock('@renderer/components/chat/messages/hooks/useMessageExportActions', () => ({
  useMessageExportActions: () => exportActionsMock
}))

vi.mock('@renderer/components/chat/messages/hooks/useMessageHeaderCapabilities', () => ({
  useMessageHeaderCapabilities: () => ({
    userProfile: undefined
  })
}))

vi.mock('@renderer/components/chat/messages/hooks/useMessageLeafCapabilities', () => ({
  useMessageLeafCapabilities: () => leafCapabilitiesMock
}))

vi.mock('@renderer/components/chat/messages/hooks/useMessageListRenderConfig', () => ({
  useMessageListRenderConfig: () => ({
    renderConfig: {
      fontSize: 14,
      multiModelMessageStyle: 'horizontal',
      narrowMode: false,
      showMessageOutline: false
    },
    updateRenderConfig: vi.fn()
  })
}))

vi.mock('@renderer/components/chat/messages/hooks/useMessageMenuConfig', () => ({
  useMessageMenuConfig: () => ({})
}))

vi.mock('@renderer/components/chat/messages/hooks/useMessageSelectionController', () => ({
  useMessageSelectionController: () => ({
    actions: {},
    selection: {
      isMultiSelectMode: false,
      selectedMessageIds: []
    }
  })
}))

vi.mock('@renderer/components/chat/messages/hooks/useMessageUiStateCache', () => ({
  useMessageUiStateCache: () => ({
    getMessageUiState: vi.fn(() => ({})),
    updateMessageUiState: vi.fn()
  })
}))

vi.mock('@renderer/components/chat/messages/messageListProviderBuilder', () => ({
  pickMessageHeaderActions: vi.fn(() => ({})),
  pickMessageLeafActions: vi.fn(() => ({})),
  pickMessageLeafState: vi.fn(() => ({}))
}))

vi.mock('@renderer/services/EventService', () => ({
  EVENT_NAMES: {
    CLEAR_MESSAGES: 'CLEAR_MESSAGES',
    COPY_TOPIC_IMAGE: 'COPY_TOPIC_IMAGE',
    EDIT_MESSAGE: 'EDIT_MESSAGE',
    EXPORT_TOPIC_IMAGE: 'EXPORT_TOPIC_IMAGE',
    LOCATE_MESSAGE: 'LOCATE_MESSAGE',
    NEW_CONTEXT: 'NEW_CONTEXT',
    SEND_MESSAGE: 'SEND_MESSAGE'
  },
  EventEmitter: eventMocks
}))

vi.mock('@renderer/utils/translate/translateInputText', () => ({
  translateInputText: vi.fn()
}))

vi.mock('@renderer/utils/translate/translateText', () => ({
  translateText: vi.fn()
}))

vi.mock('@renderer/utils/error', () => ({
  formatErrorMessageWithPrefix: vi.fn((error, prefix) => `${prefix}: ${String(error)}`),
  isAbortError: vi.fn(() => false)
}))

vi.mock('@renderer/utils/file', () => ({
  filterSupportedFiles: vi.fn((files) => files)
}))

vi.mock('@renderer/utils/markdown', () => ({
  updateCodeBlock: vi.fn((content) => content)
}))

vi.mock('@renderer/utils/message/composerTokens', () => ({
  getComposerTextFromParts: vi.fn(() => '')
}))

vi.mock('@shared/utils/model', () => ({
  isNonChatModel: vi.fn(
    (model: { capabilities?: readonly unknown[] }) =>
      model.capabilities?.some((capability) => capability === 'embedding' || capability === 'rerank') ?? false
  ),
  isVisionModel: vi.fn(() => false)
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

import { dataApiService } from '@data/DataApiService'
import { resolvePartFromParts } from '@renderer/components/chat/messages/blocks/MessagePartsContext'
import { toMessageListItem } from '@renderer/components/chat/messages/utils/messageListItem'
import { toast } from '@renderer/services/toast'
import type { Topic } from '@renderer/types/topic'
import { updateCodeBlock } from '@renderer/utils/markdown'
import { translateText } from '@renderer/utils/translate'

import { useHomeMessageListProviderValue } from '../homeMessageListAdapter'
import {
  clearPendingTopicImageActionsForTest,
  consumePendingTopicImageActions,
  requestTopicImageAction
} from '../topicImageActionBus'

const createTopic = (id: string): Topic =>
  ({
    id,
    assistantId: 'assistant-1',
    name: `Topic ${id}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    messages: []
  }) as Topic

function MessageListAdapterHarness({
  imageActionConsumer,
  streamingLayers,
  messages = [],
  onStartBranchDraft,
  onValue,
  partsByMessageId = {},
  topic
}: {
  imageActionConsumer?: 'capture'
  streamingLayers?: MessageListProviderValue['state']['streamingLayers']
  messages?: CherryUIMessage[]
  onStartBranchDraft?: MessageListProviderValue['actions']['startMessageBranch']
  onValue?: (value: MessageListProviderValue) => void
  partsByMessageId?: Record<string, CherryMessagePart[]>
  topic: Topic
}) {
  const value = useHomeMessageListProviderValue({
    topic,
    messages,
    partsByMessageId,
    streamingLayers,
    imageActionConsumer,
    onStartBranchDraft
  })

  useEffect(() => {
    onValue?.(value)
  }, [onValue, value])

  return null
}

describe('useHomeMessageListProviderValue topic image actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    modelSelectorMock.props = []
    clearPendingTopicImageActionsForTest()
    Object.defineProperty(window, 'api', {
      configurable: true,
      writable: true,
      value: {
        file: {
          openPath: vi.fn(),
          select: vi.fn(),
          showInFolder: vi.fn()
        },
        mcp: {
          abortTool: vi.fn()
        }
      }
    })
  })

  it('rejects pending requests for its topic when unmounted before runtime binding', async () => {
    const requestA = requestTopicImageAction('export', createTopic('topic-a'))
    const requestB = requestTopicImageAction('export', createTopic('topic-b'))
    requestA.promise.catch(() => undefined)
    requestB.promise.catch(() => undefined)

    const view = render(<MessageListAdapterHarness topic={createTopic('topic-a')} />)

    view.unmount()

    expect(consumePendingTopicImageActions('topic-a')).toEqual([])
    await expect(requestA.promise).rejects.toThrow('Topic image export was cancelled')
    expect(consumePendingTopicImageActions('topic-b')).toEqual([
      expect.objectContaining({ id: requestB.id, topic: expect.objectContaining({ id: 'topic-b' }) })
    ])
  })

  it('does not bind SEND_MESSAGE to scroll-to-bottom', () => {
    let value: MessageListProviderValue | undefined
    render(<MessageListAdapterHarness topic={createTopic('topic-a')} onValue={(nextValue) => (value = nextValue)} />)

    const runtime: MessageListRuntime = {
      copyTopicImage: vi.fn(),
      exportTopicImage: vi.fn(),
      locateMessage: vi.fn(),
      scrollToBottom: vi.fn()
    }

    value?.actions.bindRuntime?.(runtime)

    expect(eventMocks.on).not.toHaveBeenCalledWith('SEND_MESSAGE', runtime.scrollToBottom)
    expect(eventMocks.on).toHaveBeenCalledWith('COPY_TOPIC_IMAGE', expect.any(Function))
    expect(eventMocks.on).toHaveBeenCalledWith('EXPORT_TOPIC_IMAGE', expect.any(Function))
  })

  it('passes layered streaming state and reuses unchanged history message projections', () => {
    const historyMessage = {
      id: 'history-message',
      role: 'assistant',
      parts: [{ type: 'text', text: 'sealed history' }]
    } as CherryUIMessage
    const liveMessage = {
      id: 'live-message',
      role: 'assistant',
      parts: [{ type: 'text', text: 'a' }]
    } as CherryUIMessage
    const historyPartsByMessageId = {
      'history-message': historyMessage.parts as CherryMessagePart[]
    }
    const streamingLayers = {
      historyPartsByMessageId,
      liveMessageIds: ['live-message']
    } as NonNullable<MessageListProviderValue['state']['streamingLayers']>
    let value: MessageListProviderValue | undefined

    const view = render(
      <MessageListAdapterHarness
        topic={createTopic('topic-a')}
        messages={[historyMessage, liveMessage]}
        partsByMessageId={{ ...historyPartsByMessageId, 'live-message': liveMessage.parts as CherryMessagePart[] }}
        streamingLayers={streamingLayers}
        onValue={(nextValue) => (value = nextValue)}
      />
    )

    const firstHistoryItem = value?.state.messages[0]
    expect(value?.state.streamingLayers).toBe(streamingLayers)

    const nextLiveMessage = {
      ...liveMessage,
      parts: [...(liveMessage.parts ?? []), { type: 'text', text: 'b' } as CherryMessagePart]
    }
    view.rerender(
      <MessageListAdapterHarness
        topic={createTopic('topic-a')}
        messages={[historyMessage, nextLiveMessage]}
        partsByMessageId={{
          ...historyPartsByMessageId,
          'live-message': nextLiveMessage.parts as CherryMessagePart[]
        }}
        streamingLayers={streamingLayers}
        onValue={(nextValue) => (value = nextValue)}
      />
    )

    expect(value?.state.messages[0]).toBe(firstHistoryItem)
    expect(vi.mocked(toMessageListItem).mock.calls.filter(([message]) => message === historyMessage)).toHaveLength(1)
    expect(vi.mocked(toMessageListItem).mock.calls.filter(([message]) => message.id === liveMessage.id)).toHaveLength(2)
  })

  it.each(['embedding', 'rerank'])('filters %s models from the regenerate model picker', (capability) => {
    let value: MessageListProviderValue | undefined
    render(<MessageListAdapterHarness topic={createTopic('topic-a')} onValue={(nextValue) => (value = nextValue)} />)

    render(
      <>
        {value?.actions.renderRegenerateModelPicker?.({
          message: { id: 'message-a' } as any,
          messageParts: [],
          trigger: <button type="button">pick model</button>,
          onOpenChange: vi.fn()
        })}
      </>
    )

    const filter = modelSelectorMock.props.at(-1)?.filter
    expect(filter?.({ capabilities: [capability] })).toBe(false)
    expect(filter?.({ capabilities: [] })).toBe(true)
  })

  it('capture consumer consumes pending topic image requests without binding visible image events', async () => {
    const request = requestTopicImageAction('copy', createTopic('topic-a'), { emit: false })
    let value: MessageListProviderValue | undefined
    render(
      <MessageListAdapterHarness
        imageActionConsumer="capture"
        topic={createTopic('topic-a')}
        onValue={(nextValue) => (value = nextValue)}
      />
    )

    const runtime: MessageListRuntime = {
      copyTopicImage: vi.fn().mockResolvedValue(undefined),
      exportTopicImage: vi.fn(),
      locateMessage: vi.fn(),
      scrollToBottom: vi.fn()
    }

    value?.actions.bindRuntime?.(runtime)

    await expect(request.promise).resolves.toBeUndefined()
    expect(runtime.copyTopicImage).toHaveBeenCalledTimes(1)
    expect(commandHandlerMock).toHaveBeenCalledWith('chat.message.copy_last', expect.any(Function), {
      enabled: false
    })
    expect(commandHandlerMock).toHaveBeenCalledWith('chat.message.edit_last_user', expect.any(Function), {
      enabled: false
    })
    expect(eventMocks.on).not.toHaveBeenCalledWith('CLEAR_MESSAGES', expect.any(Function))
    expect(eventMocks.on).not.toHaveBeenCalledWith('NEW_CONTEXT', expect.any(Function))
    expect(eventMocks.on).not.toHaveBeenCalledWith('COPY_TOPIC_IMAGE', expect.any(Function))
    expect(eventMocks.on).not.toHaveBeenCalledWith('EXPORT_TOPIC_IMAGE', expect.any(Function))
    expect(consumePendingTopicImageActions('topic-a')).toEqual([])
  })

  it('capture consumer does not bind message-level global listeners', () => {
    let value: MessageListProviderValue | undefined
    render(
      <MessageListAdapterHarness
        imageActionConsumer="capture"
        topic={createTopic('topic-a')}
        onValue={(nextValue) => (value = nextValue)}
      />
    )

    value?.actions.bindMessageRuntime?.('message-a', {
      locateMessage: vi.fn(),
      startEditing: vi.fn()
    })
    value?.actions.bindMessageGroupRuntime?.(['message-a'], {
      locateMessage: vi.fn()
    })

    expect(eventMocks.on).not.toHaveBeenCalledWith('LOCATE_MESSAGE:message-a', expect.any(Function))
    expect(eventMocks.on).not.toHaveBeenCalledWith('EDIT_MESSAGE', expect.any(Function))
  })

  it('saves code block edits through chat write', async () => {
    const textPart = {
      type: 'text',
      text: '```ts\nconst value = "old"\n```'
    } as CherryMessagePart
    const updatedText = '```ts\nconst value = "new"\n```'
    const updatedPart = {
      ...textPart,
      text: updatedText
    } as CherryMessagePart
    const partsByMessageId = {
      'message-1': [textPart]
    }
    let value: MessageListProviderValue | undefined

    vi.mocked(resolvePartFromParts).mockReturnValue({
      index: 0,
      messageId: 'message-1',
      part: textPart
    })
    vi.mocked(updateCodeBlock).mockReturnValue(updatedText)

    render(
      <MessageListAdapterHarness
        topic={createTopic('topic-a')}
        partsByMessageId={partsByMessageId}
        onValue={(nextValue) => (value = nextValue)}
      />
    )

    await waitFor(() => expect(value).toBeDefined())
    await value?.actions.saveCodeBlock?.({
      msgBlockId: 'block-1',
      codeBlockId: 'code-block-1',
      newContent: 'const value = "new"'
    })

    expect(updateCodeBlock).toHaveBeenCalledWith(
      '```ts\nconst value = "old"\n```',
      'code-block-1',
      'const value = "new"'
    )
    expect(chatWriteMock.editMessage).toHaveBeenCalledWith('message-1', [updatedPart])
    expect(dataApiService.patch).not.toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith('code_block.edit.save.success')
  })

  it('starts message branches through the injected branch draft handler', async () => {
    const onStartBranchDraft = vi.fn().mockResolvedValue(undefined)
    let value: MessageListProviderValue | undefined

    render(
      <MessageListAdapterHarness
        topic={createTopic('topic-a')}
        onStartBranchDraft={onStartBranchDraft}
        onValue={(nextValue) => (value = nextValue)}
      />
    )

    await waitFor(() => expect(value).toBeDefined())
    await value?.actions.startMessageBranch?.('assistant-old')

    expect(onStartBranchDraft).toHaveBeenCalledWith('assistant-old')
    expect(chatWriteMock.setActiveNode).not.toHaveBeenCalled()
  })

  it('keeps a message translation active until its final update is persisted', async () => {
    let finishPersistingTranslation: (() => void) | undefined
    let value: MessageListProviderValue | undefined
    const persistTranslationPromise = new Promise<void>((resolve) => {
      finishPersistingTranslation = resolve
    })
    chatWriteMock.editMessage.mockResolvedValueOnce(undefined).mockReturnValueOnce(persistTranslationPromise)
    vi.mocked(translateText).mockImplementationOnce(async (_text, _language, onResponse) => {
      onResponse?.('translated reply', true)
      return 'translated reply'
    })

    render(
      <MessageListAdapterHarness
        topic={createTopic('topic-a')}
        partsByMessageId={{ 'message-1': [{ type: 'text', text: 'reply' }] as CherryMessagePart[] }}
        onValue={(nextValue) => (value = nextValue)}
      />
    )

    await waitFor(() => expect(value).toBeDefined())

    let translateAction: Promise<void> | undefined
    act(() => {
      translateAction = value?.actions.translateMessage?.(
        'message-1',
        { langCode: 'en-us' } as any,
        'reply'
      ) as Promise<void>
    })

    await waitFor(() => expect(value?.state.isMessageTranslating?.('message-1')).toBe(true))
    await waitFor(() => expect(chatWriteMock.editMessage).toHaveBeenCalledTimes(2))
    expect(value?.state.isMessageTranslating?.('message-1')).toBe(true)

    await act(async () => {
      finishPersistingTranslation?.()
      await translateAction
    })

    await waitFor(() => expect(value?.state.isMessageTranslating?.('message-1')).toBe(false))
  })

  it('shows an error when saving code block edits through chat write fails', async () => {
    const textPart = {
      type: 'text',
      text: '```ts\nconst value = "old"\n```'
    } as CherryMessagePart
    const partsByMessageId = {
      'message-1': [textPart]
    }
    let value: MessageListProviderValue | undefined

    vi.mocked(resolvePartFromParts).mockReturnValue({
      index: 0,
      messageId: 'message-1',
      part: textPart
    })
    vi.mocked(updateCodeBlock).mockReturnValue('```ts\nconst value = "new"\n```')
    chatWriteMock.editMessage.mockRejectedValueOnce(new Error('edit failed'))

    render(
      <MessageListAdapterHarness
        topic={createTopic('topic-a')}
        partsByMessageId={partsByMessageId}
        onValue={(nextValue) => (value = nextValue)}
      />
    )

    await waitFor(() => expect(value).toBeDefined())
    await value?.actions.saveCodeBlock?.({
      msgBlockId: 'block-1',
      codeBlockId: 'code-block-1',
      newContent: 'const value = "new"'
    })

    expect(chatWriteMock.editMessage).toHaveBeenCalledWith('message-1', [
      {
        ...textPart,
        text: '```ts\nconst value = "new"\n```'
      }
    ])
    expect(dataApiService.patch).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('code_block.edit.save.failed.label: Error: edit failed')
    expect(toast.success).not.toHaveBeenCalled()
  })
})
