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
  it('treats chat view=message without a topic id as a bare entry', async () => {
    await chatBeforeLoad({ search: { view: 'message' } })

    expect(mocks.resolveChatEntryTopicId).toHaveBeenCalledTimes(1)
  })

  it('does not resolve an explicit message-only chat target', async () => {
    await chatBeforeLoad({ search: { topicId: 'topic-a', view: 'message' } })

    expect(mocks.resolveChatEntryTopicId).not.toHaveBeenCalled()
  })

  it('treats agent view=message without a session id as a bare entry', async () => {
    await agentBeforeLoad({ search: { view: 'message' } })

    expect(mocks.resolveAgentEntrySessionId).toHaveBeenCalledTimes(1)
  })

  it('does not resolve an explicit message-only agent target', async () => {
    await agentBeforeLoad({ search: { sessionId: 'session-a', view: 'message' } })

    expect(mocks.resolveAgentEntrySessionId).not.toHaveBeenCalled()
  })

  it('does not resolve a feedback-intent agent entry', async () => {
    await agentBeforeLoad({ search: { intent: 'feedback' } })

    expect(mocks.resolveAgentEntrySessionId).not.toHaveBeenCalled()
  })

  it('resolves an assistant-scoped topic for a sidebar assistant entry', async () => {
    mocks.resolveChatEntryTopicIdForAssistant.mockResolvedValue('topic-assistant')

    await expect(chatBeforeLoad({ search: { assistantId: 'assistant-1' } })).rejects.toMatchObject({
      options: { to: '/app/chat', search: { topicId: 'topic-assistant' }, replace: true }
    })

    expect(mocks.resolveChatEntryTopicIdForAssistant).toHaveBeenCalledWith('assistant-1')
    expect(mocks.resolveChatEntryTopicId).not.toHaveBeenCalled()
  })

  it('falls through bare when the assistant has no topics', async () => {
    await chatBeforeLoad({ search: { assistantId: 'assistant-1' } })

    expect(mocks.resolveChatEntryTopicIdForAssistant).toHaveBeenCalledWith('assistant-1')
    expect(mocks.resolveChatEntryTopicId).not.toHaveBeenCalled()
  })

  it('resolves an agent-scoped session for a sidebar agent entry', async () => {
    mocks.resolveAgentEntrySessionIdForAgent.mockResolvedValue('session-agent')

    await expect(agentBeforeLoad({ search: { agentId: 'agent-1' } })).rejects.toMatchObject({
      options: { to: '/app/agents', search: { sessionId: 'session-agent' }, replace: true }
    })

    expect(mocks.resolveAgentEntrySessionIdForAgent).toHaveBeenCalledWith('agent-1')
    expect(mocks.resolveAgentEntrySessionId).not.toHaveBeenCalled()
  })

  it('falls through bare when the agent has no sessions', async () => {
    await agentBeforeLoad({ search: { agentId: 'agent-1' } })

    expect(mocks.resolveAgentEntrySessionIdForAgent).toHaveBeenCalledWith('agent-1')
    expect(mocks.resolveAgentEntrySessionId).not.toHaveBeenCalled()
  })
})
