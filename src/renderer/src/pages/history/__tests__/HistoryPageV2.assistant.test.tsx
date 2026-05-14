import type { Assistant } from '@shared/data/types/assistant'
import type { Topic } from '@shared/data/types/topic'
import { fireEvent, render, screen } from '@testing-library/react'
import type { InputHTMLAttributes, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hookMocks = vi.hoisted(() => ({
  useAgents: vi.fn(),
  useAllTopics: vi.fn(),
  useAssistants: vi.fn(),
  useCache: vi.fn(),
  usePins: vi.fn(),
  useSessions: vi.fn()
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: { children?: ReactNode }) => <button {...props}>{children}</button>,
  ContextMenu: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  ContextMenuContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  ContextMenuTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  EmptyState: ({ description, title }: { description?: string; title: string }) => (
    <div>
      <h2>{title}</h2>
      {description && <p>{description}</p>}
    </div>
  ),
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />
}))

vi.mock('@renderer/components/VirtualList', () => ({
  DynamicVirtualList: <T,>({ children, list }: { children: (item: T, index: number) => ReactNode; list: T[] }) => (
    <div>
      {list.map((item, index) => (
        <div key={(item as { id?: string }).id ?? index}>{children(item, index)}</div>
      ))}
    </div>
  )
}))

vi.mock('@renderer/data/hooks/useCache', () => ({
  useCache: hookMocks.useCache
}))

vi.mock('@renderer/hooks/agents/useAgentDataApi', () => ({
  useAgents: hookMocks.useAgents
}))

vi.mock('@renderer/hooks/agents/useAgentSessionStreamStatuses', () => ({
  useAgentSessionStreamStatuses: vi.fn(() => new Map())
}))

vi.mock('@renderer/hooks/agents/useSessionDataApi', () => ({
  useSessions: hookMocks.useSessions
}))

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistants: hookMocks.useAssistants
}))

vi.mock('@renderer/hooks/usePins', () => ({
  usePins: hookMocks.usePins
}))

vi.mock('@renderer/hooks/useTopicDataApi', () => ({
  mapApiTopicToRendererTopic: (topic: Topic) => ({
    id: topic.id,
    assistantId: topic.assistantId,
    name: topic.name ?? '',
    createdAt: topic.createdAt,
    updatedAt: topic.updatedAt,
    orderKey: topic.orderKey,
    messages: [],
    pinned: false,
    isNameManuallyEdited: topic.isNameManuallyEdited
  }),
  useAllTopics: hookMocks.useAllTopics
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    init: vi.fn(),
    type: '3rdParty'
  },
  useTranslation: () => ({
    t: (key: string, fallback?: string, options?: Record<string, unknown>) => {
      const labels: Record<string, string> = {
        'chat.default.name': 'Default assistant',
        'chat.default.topic.name': 'New topic',
        'common.assistant': 'Assistant',
        'common.close': 'Close',
        'history.v2.assistantSubtitle': '{{count}} topics',
        'history.v2.resultCount': '{{count}} results',
        'history.v2.searchTopic': 'Search topics...',
        'history.v2.table.emptyValue': '-',
        'history.v2.table.messages': 'Messages',
        'history.v2.table.time': 'Time',
        'history.v2.table.title': 'Title',
        'history.v2.title': 'Topic history'
      }
      const template = labels[key] ?? fallback ?? key
      return template.replace('{{count}}', String(options?.count ?? ''))
    }
  })
}))

import HistoryPageV2 from '../HistoryPageV2'

function createTopic(overrides: Partial<Topic> = {}): Topic {
  return {
    id: 'topic-alpha',
    name: 'Alpha topic',
    assistantId: 'assistant-alpha',
    isNameManuallyEdited: false,
    orderKey: 'a',
    createdAt: '2026-05-13T08:00:00.000Z',
    updatedAt: '2026-05-14T08:00:00.000Z',
    ...overrides
  }
}

function createAssistant(overrides: Partial<Assistant> = {}): Assistant {
  return {
    id: 'assistant-alpha',
    name: 'Alpha assistant',
    prompt: '',
    emoji: 'A',
    description: '',
    settings: {
      temperature: 1,
      enableTemperature: false,
      topP: 1,
      enableTopP: false,
      maxTokens: 4096,
      enableMaxTokens: false,
      streamOutput: true,
      reasoning_effort: 'default',
      mcpMode: 'auto',
      toolUseMode: 'function',
      maxToolCalls: 20,
      enableMaxToolCalls: true,
      enableWebSearch: false,
      customParameters: []
    },
    modelId: null,
    mcpServerIds: [],
    knowledgeBaseIds: [],
    createdAt: '2026-05-13T08:00:00.000Z',
    updatedAt: '2026-05-14T08:00:00.000Z',
    tags: [],
    modelName: null,
    ...overrides
  }
}

describe('HistoryPageV2 assistant mode', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="home-page"></div><div id="agent-page"></div>'
    hookMocks.useAgents.mockReset()
    hookMocks.useAllTopics.mockReset()
    hookMocks.useAssistants.mockReset()
    hookMocks.useCache.mockReset()
    hookMocks.useCache.mockReturnValue([[], vi.fn()])
    hookMocks.usePins.mockReset()
    hookMocks.usePins.mockReturnValue({ pinnedIds: [] })
    hookMocks.useSessions.mockReset()
  })

  it('selects the clicked topic and closes history', () => {
    hookMocks.useAllTopics.mockReturnValue({ topics: [createTopic()], error: undefined, isLoading: false })
    hookMocks.useAssistants.mockReturnValue({ assistants: [createAssistant()] })

    const onClose = vi.fn()
    const onTopicSelect = vi.fn()

    render(<HistoryPageV2 mode="assistant" open onClose={onClose} onTopicSelect={onTopicSelect} />)

    fireEvent.click(screen.getByRole('button', { name: /Alpha topic/ }))

    expect(onTopicSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'topic-alpha',
        name: 'Alpha topic',
        messages: [],
        pinned: false
      })
    )
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(hookMocks.useSessions).not.toHaveBeenCalled()
    expect(hookMocks.useAgents).not.toHaveBeenCalled()
  })
})
