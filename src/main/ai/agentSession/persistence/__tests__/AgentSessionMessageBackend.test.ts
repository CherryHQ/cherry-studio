import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  markTerminalError: vi.fn(),
  saveMessage: vi.fn()
}))

vi.mock('@data/services/AgentSessionMessageService', () => ({
  agentSessionMessageService: {
    markAssistantMessageTerminalError: mocks.markTerminalError,
    saveMessage: mocks.saveMessage
  }
}))

const { PersistenceListener, TerminalPersistenceError } = await import(
  '../../../streamManager/listeners/PersistenceListener'
)
const { AgentSessionMessageBackend } = await import('../AgentSessionMessageBackend')

describe('AgentSessionMessageBackend', () => {
  beforeEach(() => vi.clearAllMocks())

  it('terminalizes its placeholder when the persistence listener catches a write failure', async () => {
    mocks.saveMessage.mockImplementationOnce(() => {
      throw new Error('write failed')
    })
    const backend = new AgentSessionMessageBackend({
      sessionId: 'session-1',
      assistantMessageId: 'assistant-1'
    })
    const onPersistFailed = vi.fn()
    const listener = new PersistenceListener({ topicId: 'agent-session:session-1', backend, onPersistFailed })

    await expect(
      listener.onDone({
        status: 'success',
        finalMessage: { id: 'assistant-1', role: 'assistant', parts: [] }
      })
    ).rejects.toBeInstanceOf(TerminalPersistenceError)

    expect(mocks.markTerminalError).toHaveBeenCalledWith('session-1', 'assistant-1')
    expect(onPersistFailed).toHaveBeenCalledOnce()
  })

  it('terminalizes an empty successful Agent reply on its reserved placeholder', async () => {
    const backend = new AgentSessionMessageBackend({
      sessionId: 'session-1',
      assistantMessageId: 'assistant-1'
    })
    const listener = new PersistenceListener({ topicId: 'agent-session:session-1', backend, onPersistFailed: vi.fn() })

    await listener.onDone({ status: 'success', finalMessage: undefined })

    expect(mocks.saveMessage).toHaveBeenCalledWith(
      {
        sessionId: 'session-1',
        message: {
          id: 'assistant-1',
          role: 'assistant',
          status: 'success',
          data: { parts: [] },
          modelId: undefined
        }
      },
      { publishDataChange: true }
    )
  })
})
