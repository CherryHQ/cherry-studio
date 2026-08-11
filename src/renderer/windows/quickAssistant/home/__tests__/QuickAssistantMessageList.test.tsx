import '@testing-library/jest-dom/vitest'

import { defaultMessageRenderConfig, type MessageListItem } from '@renderer/components/chat/messages/types'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { render, screen } from '@testing-library/react'
import type { HTMLAttributes, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import QuickAssistantMessageList from '../QuickAssistantMessageList'

const listProbe = vi.hoisted(() => ({
  itemKeys: [] as string[],
  renderLimit: 4,
  topicId: '',
  groupRenderCounts: new Map<string, number>()
}))

const renderConfig = defaultMessageRenderConfig
const platformActions = {}

vi.mock('@renderer/components/chat/messages/hooks/useMessageListRenderConfig', () => ({
  useMessageListRenderConfig: () => ({ renderConfig })
}))

vi.mock('@renderer/components/chat/messages/hooks/useMessagePlatformActions', () => ({
  useMessagePlatformActions: () => platformActions
}))

vi.mock('@renderer/components/chat/messages/MultiSelectActionPopup', () => ({ default: () => null }))
vi.mock('@renderer/components/SelectionContextMenu', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>
}))
vi.mock('@renderer/components/chat/messages/layout/NarrowLayout', () => ({
  default: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>
}))
vi.mock('@renderer/components/chat/messages/frame/MessageOutline', () => ({ default: () => null }))
vi.mock('@renderer/components/chat/messages/list/MessageAnchorLine', () => ({ default: () => null }))
vi.mock('@renderer/components/chat/messages/list/MessageListSearch', () => ({ MessageListSearch: () => null }))
vi.mock('@renderer/components/chat/messages/list/MessageNavigation', () => ({ default: () => null }))
vi.mock('@renderer/components/chat/messages/list/SelectionBox', () => ({ default: () => null }))
vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({ setTimeoutTimer: (_key: string, callback: () => void) => callback() })
}))
vi.mock('@renderer/utils/image', () => ({
  captureScrollable: vi.fn(),
  captureScrollableAsDataUrl: vi.fn()
}))

vi.mock('@renderer/components/chat/messages/list/MessageGroup', () => ({
  default: ({ messages }: { messages: MessageListItem[] }) => {
    const groupId = messages.map((message) => message.id).join(',')
    listProbe.groupRenderCounts.set(groupId, (listProbe.groupRenderCounts.get(groupId) ?? 0) + 1)
    return <div data-testid="message-group">{groupId}</div>
  }
}))

vi.mock('@renderer/components/chat/messages/list/MessageVirtualList', () => ({
  MESSAGE_VIRTUAL_LIST_DEFAULT_BOTTOM_PADDING_PX: 12,
  MESSAGE_VIRTUAL_LIST_DEFAULT_TOP_PADDING_PX: 6,
  MessageVirtualList: ({
    items,
    getItemKey,
    renderItem,
    topicId
  }: {
    items: [string, MessageListItem[]][]
    getItemKey: (item: [string, MessageListItem[]], index: number) => string
    renderItem: (item: [string, MessageListItem[]], index: number) => ReactNode
    topicId?: string
  }) => {
    listProbe.itemKeys = items.map(getItemKey)
    listProbe.topicId = topicId ?? ''
    const firstRenderedIndex = Math.max(0, items.length - listProbe.renderLimit)

    return (
      <div data-testid="virtual-list">
        {items.slice(firstRenderedIndex).map((item, index) => (
          <div key={getItemKey(item, firstRenderedIndex + index)}>{renderItem(item, firstRenderedIndex + index)}</div>
        ))}
      </div>
    )
  }
}))

const createMessage = (
  id: string,
  role: CherryUIMessage['role'],
  parentId?: string,
  status: 'pending' | 'success' = 'success'
): CherryUIMessage =>
  ({
    id,
    role,
    metadata: { createdAt: '2026-08-12T00:00:00.000Z', parentId, status },
    parts: [{ type: 'text', text: id }]
  }) as CherryUIMessage

const getParts = (messages: CherryUIMessage[]): Record<string, CherryMessagePart[]> =>
  Object.fromEntries(messages.map((message) => [message.id, message.parts ?? []])) as Record<
    string,
    CherryMessagePart[]
  >

describe('QuickAssistantMessageList', () => {
  beforeEach(() => {
    listProbe.itemKeys = []
    listProbe.renderLimit = 4
    listProbe.topicId = ''
    listProbe.groupRenderCounts.clear()
  })

  it('keeps 100 chronological turns on the shared bounded virtual list with the latest turn last', () => {
    const messages = Array.from({ length: 100 }, (_, index) => {
      const userId = `user-${index}`
      return [createMessage(userId, 'user'), createMessage(`assistant-${index}`, 'assistant', userId)]
    }).flat()
    const partsByMessageId = getParts(messages)

    render(
      <QuickAssistantMessageList
        route="chat"
        topicId="topic-1"
        assistant={null}
        isOutputted
        messages={messages}
        partsByMessageId={partsByMessageId}
        streamingLayers={{ historyPartsByMessageId: partsByMessageId, liveMessageIds: [] }}
      />
    )

    expect(listProbe.itemKeys).toHaveLength(200)
    expect(listProbe.itemKeys[0]).toBe('useruser-0')
    expect(listProbe.itemKeys.at(-1)).toBe('assistantuser-99')
    expect(screen.getAllByTestId('message-group')).toHaveLength(4)
    expect(screen.getByText('assistant-99')).toBeInTheDocument()
  })

  it('keeps historical rows isolated while the live assistant updates', () => {
    listProbe.renderLimit = Number.POSITIVE_INFINITY
    const historyUser = createMessage('user-history', 'user')
    const historyAssistant = createMessage('assistant-history', 'assistant', historyUser.id)
    const liveAssistant = createMessage('assistant-live', 'assistant', 'user-live', 'pending')
    const historyMessages = [historyUser, historyAssistant]
    const historyPartsByMessageId = getParts(historyMessages)
    const buildParts = (text: string) => ({
      ...historyPartsByMessageId,
      'assistant-live': [{ type: 'text', text }] as CherryMessagePart[]
    })

    const view = render(
      <QuickAssistantMessageList
        route="chat"
        topicId="topic-1"
        assistant={null}
        isOutputted
        messages={[...historyMessages, liveAssistant]}
        partsByMessageId={buildParts('a')}
        streamingLayers={{ historyPartsByMessageId, liveMessageIds: [liveAssistant.id] }}
      />
    )

    view.rerender(
      <QuickAssistantMessageList
        route="chat"
        topicId="topic-1"
        assistant={null}
        isOutputted
        messages={[...historyMessages, { ...liveAssistant }]}
        partsByMessageId={buildParts('ab')}
        streamingLayers={{ historyPartsByMessageId, liveMessageIds: [liveAssistant.id] }}
      />
    )

    expect(listProbe.groupRenderCounts.get(historyUser.id)).toBe(1)
    expect(listProbe.groupRenderCounts.get(historyAssistant.id)).toBe(1)
    expect(listProbe.groupRenderCounts.get(liveAssistant.id)).toBe(2)
  })

  it('filters the source row for summary views and drops all rows when the temporary topic resets', () => {
    listProbe.renderLimit = Number.POSITIVE_INFINITY
    const user = createMessage('user-1', 'user')
    const assistant = createMessage('assistant-1', 'assistant', user.id)
    const messages = [user, assistant]
    const partsByMessageId = getParts(messages)
    const view = render(
      <QuickAssistantMessageList
        route="summary"
        topicId="topic-1"
        assistant={null}
        isOutputted
        messages={messages}
        partsByMessageId={partsByMessageId}
        streamingLayers={{ historyPartsByMessageId: partsByMessageId, liveMessageIds: [] }}
      />
    )

    expect(listProbe.itemKeys).toEqual([`assistant${user.id}`])

    view.rerender(
      <QuickAssistantMessageList
        route="chat"
        topicId="topic-2"
        assistant={null}
        isOutputted={false}
        messages={[]}
        partsByMessageId={{}}
        streamingLayers={{ historyPartsByMessageId: {}, liveMessageIds: [] }}
      />
    )

    expect(listProbe.itemKeys).toEqual([])
    expect(listProbe.topicId).toBe('topic-2')
  })
})
