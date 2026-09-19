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

const { PersistenceListener, TerminalPersistenceError } =
  await import('../../../streamManager/listeners/PersistenceListener')
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

  it('downgrades an empty successful Agent reply to a terminal error on its reserved placeholder', async () => {
    const afterPersist = vi.fn().mockResolvedValue(undefined)
    const backend = new AgentSessionMessageBackend({
      sessionId: 'session-1',
      assistantMessageId: 'assistant-1',
      afterPersist
    })
    const listener = new PersistenceListener({ topicId: 'agent-session:session-1', backend, onPersistFailed: vi.fn() })

    await listener.onDone({ status: 'success', finalMessage: undefined })

    expect(mocks.saveMessage).toHaveBeenCalledWith(
      {
        sessionId: 'session-1',
        message: {
          id: 'assistant-1',
          role: 'assistant',
          status: 'error',
          data: { parts: [expect.objectContaining({ type: 'data-error' })] },
          modelId: undefined
        }
      },
      { publishDataChange: true }
    )
    const saved = mocks.saveMessage.mock.calls[0][0]
    expect(saved.message.data.parts[0].data).toMatchObject({
      name: 'AgentRuntimeError',
      i18nKey: 'agent_turn_no_output',
      reason: 'empty-success-terminal'
    })
    expect(afterPersist).not.toHaveBeenCalled()
  })

  it('keeps an empty paused turn paused and persists a visible resume hint', async () => {
    const backend = new AgentSessionMessageBackend({ sessionId: 'session-1', assistantMessageId: 'assistant-1' })
    backend.persistAssistant({ status: 'paused', finalMessage: undefined } as never)
    expect(mocks.saveMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({
          status: 'paused',
          data: { parts: [{ type: 'data-agent-paused', data: {} }] }
        })
      }),
      { publishDataChange: true }
    )
  })

  it('downgrades a successful turn whose only parts are hidden or empty to a terminal error', async () => {
    const backend = new AgentSessionMessageBackend({
      sessionId: 'session-1',
      assistantMessageId: 'assistant-1'
    })
    const listener = new PersistenceListener({ topicId: 'agent-session:session-1', backend, onPersistFailed: vi.fn() })

    await listener.onDone({
      status: 'success',
      finalMessage: {
        id: 'assistant-1',
        role: 'assistant',
        parts: [
          { type: 'step-start' },
          { type: 'data-agent-task-event', data: { event: 'started', taskId: 'task-1' } },
          { type: 'text', text: '   ' },
          { type: 'reasoning', state: 'done', text: '' }
        ]
      } as never
    })

    const saved = mocks.saveMessage.mock.calls[0][0]
    expect(saved.message.status).toBe('error')
    expect(saved.message.data.parts.filter((part: { type: string }) => part.type === 'data-error')).toHaveLength(1)
  })

  it('persists a successful turn with visible content unchanged', async () => {
    const backend = new AgentSessionMessageBackend({
      sessionId: 'session-1',
      assistantMessageId: 'assistant-1'
    })
    const listener = new PersistenceListener({ topicId: 'agent-session:session-1', backend, onPersistFailed: vi.fn() })

    await listener.onDone({
      status: 'success',
      finalMessage: {
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'answer' }]
      }
    })

    expect(mocks.saveMessage).toHaveBeenCalledWith(
      {
        sessionId: 'session-1',
        message: {
          id: 'assistant-1',
          role: 'assistant',
          status: 'success',
          data: { parts: [{ type: 'text', text: 'answer' }] },
          modelId: undefined
        }
      },
      { publishDataChange: true }
    )
  })
})
