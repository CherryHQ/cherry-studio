import type { MessageListProviderValue } from '@renderer/components/chat/messages/types'
import type { Topic } from '@renderer/types/topic'
import type { Message as SharedMessage } from '@shared/data/types/message'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const dataApiGetMock = vi.hoisted(() => vi.fn())
const homeMessageListProviderMock = vi.hoisted(() => vi.fn(() => ({}) as MessageListProviderValue))

vi.mock('@data/DataApiService', () => ({
  dataApiService: {
    get: dataApiGetMock
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn()
    })
  }
}))

vi.mock('@renderer/components/chat/messages/MessageImageCaptureHost', () => ({
  default: ({ ready, testId }: { ready: boolean; testId: string }) =>
    ready ? <div data-testid={testId}>capture host</div> : null
}))

vi.mock('../homeMessageListAdapter', async () => {
  const { useMessageEditing } = (await vi.importActual('@renderer/components/chat/editing/MessageEditingContext')) as {
    useMessageEditing: () => unknown
  }

  return {
    useHomeMessageListProviderValue: vi.fn(() => {
      useMessageEditing()
      return homeMessageListProviderMock()
    })
  }
})

vi.mock('../topicImageActionBus', () => ({
  rejectPendingTopicImageActions: vi.fn()
}))

const { default: TopicImageCaptureHost, getTopicImageCaptureMessages } = await import('../TopicImageCaptureHost')

const createMessage = (
  id: string,
  role: 'user' | 'assistant',
  createdAt: string,
  overrides: Partial<SharedMessage> = {}
): SharedMessage =>
  ({
    id,
    topicId: 'topic-a',
    parentId: 'root-a',
    role,
    data: { parts: [{ type: 'text', text: id }] },
    searchableText: id,
    status: 'success',
    siblingsGroupId: 0,
    modelId: null,
    modelSnapshot: null,
    stats: null,
    createdAt,
    updatedAt: createdAt,
    ...overrides
  }) as SharedMessage

beforeEach(() => {
  dataApiGetMock.mockReset()
  homeMessageListProviderMock.mockClear()
})

describe('TopicImageCaptureHost', () => {
  it('provides message editing context for the offscreen home message list adapter', async () => {
    dataApiGetMock.mockResolvedValueOnce({
      items: [],
      nextCursor: undefined
    })
    const topic = {
      id: 'topic-a',
      assistantId: 'assistant-a',
      name: 'Topic A',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      messages: []
    } as Topic

    render(<TopicImageCaptureHost topic={topic} />)

    expect(await screen.findByTestId('topic-image-capture-host')).toBeInTheDocument()
  })

  it('projects sibling branch responses like the visible topic message list for capture', async () => {
    const activeUser = createMessage('user-active', 'user', '2026-01-01T00:00:00.000Z', { siblingsGroupId: 1 })
    const offPathUser = createMessage('user-off-path', 'user', '2026-01-01T00:00:01.000Z', { siblingsGroupId: 1 })
    const olderModelA = createMessage('assistant-model-a-old', 'assistant', '2026-01-01T00:00:02.000Z', {
      siblingsGroupId: 2,
      modelId: 'model-a'
    })
    const activeModelA = createMessage('assistant-model-a-active', 'assistant', '2026-01-01T00:00:03.000Z', {
      siblingsGroupId: 2,
      modelId: 'model-a'
    })
    const modelB = createMessage('assistant-model-b', 'assistant', '2026-01-01T00:00:04.000Z', {
      siblingsGroupId: 2,
      modelId: 'model-b'
    })

    dataApiGetMock.mockResolvedValueOnce({
      items: [
        { message: activeUser, siblingsGroup: [offPathUser] },
        { message: activeModelA, siblingsGroup: [olderModelA, modelB] }
      ],
      nextCursor: undefined
    })

    const messages = await getTopicImageCaptureMessages('topic-a')

    expect(messages.map((message) => message.id)).toEqual([
      'user-active',
      'assistant-model-a-active',
      'assistant-model-b'
    ])
    expect(messages.map((message) => message.metadata?.isActiveBranch)).toEqual([true, true, false])
  })
})
