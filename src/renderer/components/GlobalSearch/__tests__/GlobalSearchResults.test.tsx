// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { GlobalSearchPanelItem } from '../globalSearchGroups'
import { GlobalSearchRow } from '../GlobalSearchResults'

const data = vi.hoisted(() => ({
  topics: {} as Record<string, { assistantId: string | null }>,
  assistants: {} as Record<string, { name: string }>,
  sessions: {} as Record<
    string,
    { agentId: string | null; workspace: { name: string; path: string; type: 'user' | 'system' } }
  >,
  agents: {} as Record<string, { name: string }>
}))

const updates = vi.hoisted(() => ({ version: 0, listeners: new Set<() => void>() }))

function publishDataChange() {
  act(() => {
    updates.version += 1
    updates.listeners.forEach((listener) => listener())
  })
}

vi.mock('@renderer/hooks/useTopic', async () => {
  const { useSyncExternalStore } = await import('react')
  return {
    useTopicById: (id: string) => {
      useSyncExternalStore(
        (listener) => {
          updates.listeners.add(listener)
          return () => {
            updates.listeners.delete(listener)
          }
        },
        () => updates.version
      )
      return { topic: data.topics[id] }
    }
  }
})
vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistantApiById: (id?: string) => ({ assistant: id ? data.assistants[id] : undefined })
}))
vi.mock('@renderer/hooks/agent/useSession', async () => {
  const { useSyncExternalStore } = await import('react')
  return {
    useSession: (id: string) => {
      useSyncExternalStore(
        (listener) => {
          updates.listeners.add(listener)
          return () => {
            updates.listeners.delete(listener)
          }
        },
        () => updates.version
      )
      return { session: data.sessions[id] }
    }
  }
})
vi.mock('@renderer/hooks/agent/useAgent', () => ({
  useAgent: (id: string | null) => ({ agent: id ? data.agents[id] : undefined })
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

type RowItem = Exclude<GlobalSearchPanelItem, { kind: 'message' | 'message-parent' }>
const props = { active: false, language: 'en-US', query: '', onMouseEnter: vi.fn(), onOpen: vi.fn() }

function topicItem(recent: boolean): RowItem {
  return recent
    ? {
        kind: 'recent',
        id: 'topic:topic-1',
        recent: { kind: 'topic', topicId: 'topic-1', title: 'A chat', lastAccessTime: 1 }
      }
    : {
        kind: 'result',
        id: 'topic:topic-1',
        result: { type: 'topic', id: 'topic-1', title: 'A chat', subtitle: 'Old owner', target: { topicId: 'topic-1' } }
      }
}

function sessionItem(recent: boolean): RowItem {
  return recent
    ? {
        kind: 'recent',
        id: 'session:session-1',
        recent: { kind: 'session', sessionId: 'session-1', title: 'A task', lastAccessTime: 1 }
      }
    : {
        kind: 'result',
        id: 'session:session-1',
        result: {
          type: 'session',
          id: 'session-1',
          title: 'A task',
          subtitle: 'Old agent',
          target: { sessionId: 'session-1', agentId: 'agent-1' }
        }
      }
}

beforeEach(() => {
  data.topics = { 'topic-1': { assistantId: 'assistant-1' } }
  data.assistants = { 'assistant-1': { name: 'Default assistant' } }
  data.sessions = {
    'session-1': {
      agentId: 'agent-1',
      workspace: { name: 'CherryStudio', path: 'D:\\code\\cherry-studio', type: 'user' }
    }
  }
  data.agents = { 'agent-1': { name: 'CherryClaw' } }
  vi.clearAllMocks()
})
afterEach(cleanup)

describe.each([true, false])('global search entry context (recent=%s)', (recent) => {
  it('shows the actual assistant on a chat row without duplicating the old subtitle', async () => {
    const user = userEvent.setup()
    render(<GlobalSearchRow {...props} item={topicItem(recent)} />)
    expect(screen.getByRole('option')).toHaveTextContent('A chatDefault assistant')
    expect(screen.queryByText('Old owner')).not.toBeInTheDocument()
    await user.click(screen.getByText('Default assistant'))
    expect(props.onOpen).toHaveBeenCalledOnce()
  })

  it('shows the agent and named workspace, with the full path available on hover', () => {
    render(<GlobalSearchRow {...props} item={sessionItem(recent)} />)
    expect(screen.getByText('CherryClaw | CherryStudio')).toHaveAttribute(
      'title',
      'CherryClaw | D:\\code\\cherry-studio'
    )
    expect(screen.queryByText('Old agent')).not.toBeInTheDocument()
  })

  it('hides system workspace paths and handles deleted owners without inventing a default', () => {
    data.sessions['session-1'].workspace.type = 'system'
    render(<GlobalSearchRow {...props} item={sessionItem(recent)} />)
    expect(screen.getByText('CherryClaw')).toBeInTheDocument()
    expect(screen.queryByText(/CherryStudio/)).not.toBeInTheDocument()
    data.sessions['session-1'].agentId = null
    publishDataChange()
    expect(screen.getByRole('option')).toHaveTextContent(/^A task$/)
  })

  it('renders the title while context is unavailable and updates when it arrives or changes', () => {
    data.topics = {}
    render(<GlobalSearchRow {...props} item={topicItem(recent)} />)
    expect(screen.getByRole('option')).toHaveTextContent(/^A chat$/)
    data.topics['topic-1'] = { assistantId: 'assistant-1' }
    publishDataChange()
    expect(screen.getByText('Default assistant')).toBeInTheDocument()
    data.assistants['assistant-2'] = { name: 'Another assistant' }
    data.topics['topic-1'].assistantId = 'assistant-2'
    publishDataChange()
    expect(screen.getByText('Another assistant')).toBeInTheDocument()
    expect(screen.queryByText('Default assistant')).not.toBeInTheDocument()
  })
})

describe('non-conversation search subtitles', () => {
  it('preserves an assistant result subtitle', () => {
    render(
      <GlobalSearchRow
        {...props}
        item={{
          kind: 'result',
          id: 'assistant:1',
          result: {
            type: 'assistant',
            id: '1',
            title: 'Writing assistant',
            subtitle: 'Helps edit drafts',
            target: { assistantId: '1' }
          }
        }}
      />
    )
    expect(screen.getByRole('option')).toHaveTextContent('Writing assistantHelps edit drafts')
  })

  it('uses the type label when a knowledge base has no subtitle', () => {
    render(
      <GlobalSearchRow
        {...props}
        item={{
          kind: 'result',
          id: 'knowledge-base:1',
          result: {
            type: 'knowledge-base',
            id: '1',
            title: 'Project docs',
            target: { knowledgeBaseId: '1' }
          }
        }}
      />
    )
    expect(screen.getByRole('option')).toHaveTextContent('Project docscommon.knowledge_base')
  })
})
