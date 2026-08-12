import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  markTerminalError: vi.fn()
}))

vi.mock('@data/services/AgentSessionMessageService', () => ({
  agentSessionMessageService: {
    markAssistantMessageTerminalError: mocks.markTerminalError
  }
}))

const { AgentSessionMessageBackend } = await import('../AgentSessionMessageBackend')

describe('AgentSessionMessageBackend', () => {
  beforeEach(() => vi.clearAllMocks())

  it('terminalizes its placeholder after persistence fails', () => {
    const backend = new AgentSessionMessageBackend({
      sessionId: 'session-1',
      assistantMessageId: 'assistant-1'
    })

    backend.markTerminalError()

    expect(mocks.markTerminalError).toHaveBeenCalledWith('session-1', 'assistant-1')
  })
})
