import type { MessageListProviderValue, MessageListRuntime } from '@renderer/components/chat/messages/types'
import type { Topic } from '@renderer/types'
import { render } from '@testing-library/react'
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

vi.mock('@renderer/components/chat/messages/blocks', () => ({
  resolvePartFromParts: vi.fn(() => undefined)
}))

vi.mock('@renderer/components/chat/messages/utils/messageListItem', () => ({
  getMessageListItemModel: vi.fn(() => undefined),
  modelToSnapshot: vi.fn(() => undefined),
  toMessageListItem: vi.fn((message) => message)
}))

vi.mock('@renderer/components/Selector', () => ({
  ModelSelector: ({ trigger }: { trigger: ReactNode }) => <>{trigger}</>
}))

vi.mock('@renderer/config/models', () => ({
  isVisionModel: vi.fn(() => false)
}))

vi.mock('@renderer/config/models/_bridge', () => ({
  toSharedCompatModel: vi.fn(() => undefined)
}))

vi.mock('@renderer/components/chat/messages/editing/MessageEditingContext', () => ({
  useMessageEditing: () => ({ editingMessageId: null, editingMessage: null, startEditing: vi.fn() })
}))

vi.mock('@renderer/hooks/chat/ChatWriteContext', () => ({
  useChatWrite: () => undefined
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
  isNonChatModel: vi.fn(() => false),
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
  onValue,
  topic
}: {
  onValue?: (value: MessageListProviderValue) => void
  topic: Topic
}) {
  const value = useHomeMessageListProviderValue({
    topic,
    messages: [],
    partsByMessageId: {}
  })

  useEffect(() => {
    onValue?.(value)
  }, [onValue, value])

  return null
}

describe('useHomeMessageListProviderValue topic image actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearPendingTopicImageActionsForTest()
    Object.defineProperty(window, 'modal', {
      configurable: true,
      writable: true,
      value: { confirm: vi.fn() }
    })
    Object.defineProperty(window, 'toast', {
      configurable: true,
      writable: true,
      value: {
        error: vi.fn(),
        info: vi.fn(),
        success: vi.fn()
      }
    })
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
})
