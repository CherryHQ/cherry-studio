import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentRouteSearch } from '@renderer/pages/agents/routeSearch'
import type { ChatRouteSearch } from '@renderer/pages/home/routeSearch'

const mocks = vi.hoisted(() => ({
  resolveAgentEntrySessionId: vi.fn(),
  resolveAgentEntrySessionIdForAgent: vi.fn(),
  resolveChatEntryTopicId: vi.fn(),
  resolveChatEntryTopicIdForAssistant: vi.fn()
}))

vi.mock('@renderer/pages/agents/AgentPage', () => ({ default: () => null }))
vi.mock('@renderer/pages/home/HomePage', () => ({ default: () => null }))
vi.mock('@renderer/utils/conversationEntry', () => mocks)

import { Route as AgentRoute } from '../agents'
import { Route as ChatRoute } from '../chat'

type EntryBeforeLoad<TSearch> = (args: { search: TSearch }) => Promise<void>

const chatBeforeLoad = ChatRoute.options.beforeLoad as EntryBeforeLoad<ChatRouteSearch>
const agentBeforeLoad = AgentRoute.options.beforeLoad as EntryBeforeLoad<AgentRouteSearch>

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveChatEntryTopicId.mockResolvedValue(null)
  mocks.resolveAgentEntrySessionId.mockResolvedValue(null)
  mocks.resolveChatEntryTopicIdForAssistant.mockResolvedValue(null)
  mocks.resolveAgentEntrySessionIdForAgent.mockResolvedValue(null)
})

describe('conversation entry route guards', () => {
  it('resolves the entry target for a bare chat entry', async () => {
    mocks.resolveChatEntryTopicId.mockResolvedValue('topic-last')

    await expect(chatBeforeLoad({ search: {} })).rejects.toMatchObject({
      options: { to: '/app/chat', search: { topicId: 'topic-last' }, replace: true }
    })
  })

  it('does not resolve a chat entry that already carries a topic id', async () => {
    await expect(chatBeforeLoad({ search: { topicId: 'topic-a' } })).resolves.toBeUndefined()
  })

  it('resolves the entry target for a bare agent entry', async () => {
    mocks.resolveAgentEntrySessionId.mockResolvedValue('session-last')

    await expect(agentBeforeLoad({ search: {} })).rejects.toMatchObject({
      options: { to: '/app/agents', search: { sessionId: 'session-last' }, replace: true }
    })
  })

  it('does not resolve an agent entry that already carries a session id', async () => {
    await expect(agentBeforeLoad({ search: { sessionId: 'session-a' } })).resolves.toBeUndefined()
  })

  it('binds canonically and preserves that session on a later load after a newer session exists', async () => {
    mocks.resolveAgentEntrySessionIdForAgent.mockResolvedValue('session-s1')
    let boundSearch: AgentRouteSearch = {}
    try {
      await agentBeforeLoad({ search: { agentId: 'agent-1' } })
    } catch (redirect) {
      const options = (redirect as { options: { search: AgentRouteSearch; replace: boolean } }).options
      expect(options).toMatchObject({ to: '/app/agents', search: { sessionId: 'session-s1' }, replace: true })
      boundSearch = options.search
    }
    expect(boundSearch).toEqual({ sessionId: 'session-s1' })

    mocks.resolveAgentEntrySessionIdForAgent.mockResolvedValue('session-s2')
    mocks.resolveAgentEntrySessionId.mockResolvedValue('session-s2')
    await expect(agentBeforeLoad({ search: boundSearch })).resolves.toBeUndefined()
    expect(boundSearch).toEqual({ sessionId: 'session-s1' })
  })

  it('does not resolve a feedback-intent agent entry', async () => {
    await expect(agentBeforeLoad({ search: { intent: 'feedback' } })).resolves.toBeUndefined()
  })

  it('resolves an assistant-scoped topic for a sidebar assistant entry', async () => {
    mocks.resolveChatEntryTopicIdForAssistant.mockResolvedValue('topic-assistant')

    await expect(chatBeforeLoad({ search: { assistantId: 'assistant-1' } })).rejects.toMatchObject({
      options: { to: '/app/chat', search: { topicId: 'topic-assistant' }, replace: true }
    })
  })

  it('falls through bare when the assistant has no topics', async () => {
    await expect(chatBeforeLoad({ search: { assistantId: 'assistant-1' } })).resolves.toBeUndefined()
  })

  it('resolves an agent-scoped session for a sidebar agent entry', async () => {
    mocks.resolveAgentEntrySessionIdForAgent.mockResolvedValue('session-agent')

    await expect(agentBeforeLoad({ search: { agentId: 'agent-1' } })).rejects.toMatchObject({
      options: {
        to: '/app/agents',
        search: { sessionId: 'session-agent' },
        replace: true
      }
    })
  })

  it('falls through bare when the agent has no sessions', async () => {
    await expect(agentBeforeLoad({ search: { agentId: 'agent-1' } })).resolves.toBeUndefined()
  })
})
