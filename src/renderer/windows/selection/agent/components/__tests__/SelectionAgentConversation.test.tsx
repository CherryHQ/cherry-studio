import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  agent: undefined as
    | { id: string; name: string; type: string; model: string | null; modelName: string | null }
    | undefined,
  model: undefined as { id: string } | undefined,
  sendMessage: vi.fn(async () => true)
}))

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@renderer/hooks/agent/useSession', () => ({
  useSession: (sessionId: string) => ({ session: { id: sessionId, agentId: 'agent-1', name: '' } })
}))
vi.mock('@renderer/hooks/agent/useAgent', () => ({ useAgent: () => ({ agent: mocks.agent, isLoading: false }) }))
vi.mock('@renderer/hooks/useModel', () => ({ useModelById: () => ({ model: mocks.model }) }))
vi.mock('@renderer/hooks/agent/useAgentWorkspaceWarning', () => ({ useAgentWorkspaceWarning: () => undefined }))
vi.mock('@renderer/pages/agents/useAgentChatRuntimeState', () => ({
  useAgentChatRuntimeState: ({ sessionId }: { sessionId: string }) => ({
    sessionId,
    sendMessage: mocks.sendMessage,
    uiMessages: [],
    partsByMessageId: {},
    isPending: false
  })
}))
vi.mock('@renderer/pages/agents/components/AgentSessionMessages', () => ({ default: () => null }))
vi.mock('@renderer/pages/agents/AgentComposerSlot', () => ({ default: () => null }))
vi.mock('../SelectionAgentHeader', () => ({ SelectionAgentHeader: () => null }))

const { SelectionAgentConversation } = await import('../SelectionAgentConversation')
type FirstMessage = Parameters<typeof SelectionAgentConversation>[0]['firstMessage']

const QUOTE_PARTS = [{ type: 'text' as const, text: '<blockquote>x</blockquote>\nWhy?' }]

function renderConversation(firstMessage: FirstMessage = { text: 'Why?', userMessageParts: QUOTE_PARTS }) {
  return render(
    <SelectionAgentConversation
      sessionId="session-1"
      firstMessage={firstMessage}
      isPinned={false}
      onTogglePin={() => undefined}
      opacity={100}
      onOpacityChange={() => undefined}
    />
  )
}

describe('SelectionAgentConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.agent = { id: 'agent-1', name: 'Dev', type: 'claude-code', model: 'openai::gpt-5', modelName: 'GPT-5' }
    mocks.model = { id: 'openai::gpt-5' }
  })

  it('sends the first message once, keeping its composer parts', () => {
    const { rerender } = renderConversation()
    rerender(
      <SelectionAgentConversation
        sessionId="session-1"
        firstMessage={{ text: 'Why?', userMessageParts: QUOTE_PARTS }}
        isPinned
        onTogglePin={() => undefined}
        opacity={80}
        onOpacityChange={() => undefined}
      />
    )

    expect(mocks.sendMessage).toHaveBeenCalledExactlyOnceWith(
      { text: 'Why?' },
      { body: { agentId: 'agent-1', sessionId: 'session-1', userMessageParts: QUOTE_PARTS } }
    )
  })

  it('holds the first message while the agent has no model, then sends it once one is set', () => {
    mocks.agent = { id: 'agent-1', name: 'Cherry Assistant', type: 'claude-code', model: null, modelName: null }
    mocks.model = undefined
    const { rerender } = renderConversation({ text: 'Summarize this' })

    expect(mocks.sendMessage).not.toHaveBeenCalled()
    expect(screen.getByText('selection.agent.no_model_notice')).toBeInTheDocument()

    mocks.agent = { ...mocks.agent, model: 'openai::gpt-5', modelName: 'GPT-5' }
    mocks.model = { id: 'openai::gpt-5' }
    rerender(
      <SelectionAgentConversation
        sessionId="session-1"
        firstMessage={{ text: 'Summarize this' }}
        isPinned={false}
        onTogglePin={() => undefined}
        opacity={100}
        onOpacityChange={() => undefined}
      />
    )

    expect(mocks.sendMessage).toHaveBeenCalledExactlyOnceWith({ text: 'Summarize this' }, undefined)
  })
})
