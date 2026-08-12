import '@testing-library/jest-dom/vitest'

import { defaultMessageRenderConfig, type MessageListItem } from '@renderer/components/chat/messages/types'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { Model } from '@shared/data/types/model'
import { render, screen } from '@testing-library/react'
import dayjs from 'dayjs'
import type { HTMLAttributes, ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import QuickAssistantMessageList from '../QuickAssistantMessageList'

vi.mock('@renderer/components/chat/messages/hooks/useMessageListRenderConfig', () => ({
  useMessageListRenderConfig: () => ({ renderConfig: defaultMessageRenderConfig })
}))

vi.mock('@renderer/components/chat/messages/hooks/useMessagePlatformActions', () => ({
  useMessagePlatformActions: () => ({})
}))

vi.mock('@renderer/components/chat/messages/MultiSelectActionPopup', () => ({ default: () => null }))
vi.mock('@renderer/components/SelectionContextMenu', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>
}))
vi.mock('@renderer/components/chat/messages/layout/NarrowLayout', () => ({
  default: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>
}))
vi.mock('@renderer/components/chat/messages/frame/MessageContent', () => ({ default: () => null }))
vi.mock('@renderer/components/chat/messages/frame/MessageMenuBar', () => ({ default: () => null }))
vi.mock('@renderer/components/chat/messages/frame/MessageOutline', () => ({ default: () => null }))
vi.mock('@renderer/components/chat/messages/list/MessageAnchorLine', () => ({ default: () => null }))
vi.mock('@renderer/components/chat/messages/list/MessageGroupMenuBar', () => ({ default: () => null }))
vi.mock('@renderer/components/chat/messages/list/MessageListSearch', () => ({ MessageListSearch: () => null }))
vi.mock('@renderer/components/chat/messages/list/MessageNavigation', () => ({ default: () => null }))
vi.mock('@renderer/components/chat/messages/list/SelectionBox', () => ({ default: () => null }))
vi.mock('@renderer/components/chat/messages/list/SiblingNavigator', () => ({ default: () => null }))
vi.mock('@renderer/components/HorizontalScrollContainer', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>
}))
vi.mock('@renderer/hooks/useTheme', () => ({ useTheme: () => ({ theme: 'light' }) }))
vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({ setTimeoutTimer: (_key: string, callback: () => void) => callback() })
}))
vi.mock('@renderer/utils/image', () => ({
  captureScrollable: vi.fn(),
  captureScrollableAsDataUrl: vi.fn()
}))
vi.mock('@cherrystudio/ui/icons', async (importOriginal) => {
  const Icon = Object.assign(() => <span data-testid="model-icon" />, {
    Avatar: () => <span data-testid="model-avatar" />
  })
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    useIcon: () => Icon
  }
})
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

vi.mock('@renderer/components/chat/messages/list/MessageVirtualList', () => ({
  MESSAGE_VIRTUAL_LIST_DEFAULT_BOTTOM_PADDING_PX: 12,
  MESSAGE_VIRTUAL_LIST_DEFAULT_TOP_PADDING_PX: 6,
  MessageVirtualList: ({
    items,
    renderItem
  }: {
    items: [string, MessageListItem[]][]
    renderItem: (item: [string, MessageListItem[]], index: number) => ReactNode
  }) => (
    <div>
      {items.map((item, index) => (
        <div key={item[0]}>{renderItem(item, index)}</div>
      ))}
    </div>
  )
}))

const model: Model = {
  id: 'cherryai::qwen',
  providerId: 'cherryai',
  apiModelId: 'qwen',
  name: 'Qwen',
  capabilities: [],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false
}

const createModelOnlyMessage = (): CherryUIMessage =>
  ({
    id: 'assistant-1',
    role: 'assistant',
    parts: [{ type: 'text', text: 'Hello' }]
  }) as CherryUIMessage

describe('QuickAssistantMessageList display metadata', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows stable model identity and time for a production-shaped model-only response', () => {
    const initialTime = new Date('2026-08-12T08:00:00.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(initialTime)
    const message = createModelOnlyMessage()

    const view = render(
      <QuickAssistantMessageList
        route="chat"
        topicId="topic-1"
        assistant={null}
        model={model}
        isOutputted
        messages={[message]}
        partsByMessageId={{ [message.id]: message.parts ?? [] }}
        streamingLayers={{ historyPartsByMessageId: {}, liveMessageIds: [message.id] }}
      />
    )

    const timestamp = dayjs(initialTime).format('MM/DD HH:mm')
    expect(screen.getAllByText('Qwen')).not.toHaveLength(0)
    expect(screen.getByText(timestamp)).toBeInTheDocument()
    expect(screen.queryByText('Invalid Date')).not.toBeInTheDocument()

    vi.setSystemTime(new Date('2026-08-12T08:01:00.000Z'))
    view.rerender(
      <QuickAssistantMessageList
        route="chat"
        topicId="topic-1"
        assistant={null}
        model={model}
        isOutputted
        messages={[{ ...message }]}
        partsByMessageId={{ [message.id]: message.parts ?? [] }}
        streamingLayers={{ historyPartsByMessageId: {}, liveMessageIds: [message.id] }}
      />
    )

    expect(screen.getByText(timestamp)).toBeInTheDocument()
    expect(screen.queryByText(dayjs().format('MM/DD HH:mm'))).not.toBeInTheDocument()
  })
})
