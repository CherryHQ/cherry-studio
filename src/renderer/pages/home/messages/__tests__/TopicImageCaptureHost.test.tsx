import type { MessageListProviderValue } from '@renderer/components/chat/messages/types'
import type { Topic } from '@renderer/types/topic'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn()
    })
  }
}))

vi.mock('@renderer/components/chat/messages/hooks/useMessageImageCaptureMessages', () => ({
  useMessageImageCaptureMessages: () => ({
    messages: [],
    partsByMessageId: {}
  })
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
      return {} as MessageListProviderValue
    })
  }
})

vi.mock('../topicImageActionBus', () => ({
  rejectPendingTopicImageActions: vi.fn()
}))

const { default: TopicImageCaptureHost } = await import('../TopicImageCaptureHost')

describe('TopicImageCaptureHost', () => {
  it('provides message editing context for the offscreen home message list adapter', () => {
    const topic = {
      id: 'topic-a',
      assistantId: 'assistant-a',
      name: 'Topic A',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      messages: []
    } as Topic

    render(<TopicImageCaptureHost topic={topic} />)

    expect(screen.getByTestId('topic-image-capture-host')).toBeInTheDocument()
  })
})
