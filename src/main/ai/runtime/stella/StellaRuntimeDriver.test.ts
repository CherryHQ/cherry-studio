import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  sendMessage: vi.fn(),
  getAgent: vi.fn()
}))

vi.mock('@data/services/AgentService', () => ({ agentService: { getAgent: mocks.getAgent } }))
vi.mock('./StellaClient', () => ({
  stellaClient: { createSession: mocks.createSession, sendMessage: mocks.sendMessage }
}))

const { StellaRuntimeConnection, StellaRuntimeDriver } = await import('./StellaRuntimeDriver')

function sse(frames: string[], newline = '\n') {
  return new Response(frames.map((frame) => `data: ${frame}${newline}${newline}`).join(''))
}

describe('StellaRuntimeConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createSession.mockResolvedValue('remote-session')
  })

  it('creates a session, maps UI-message v1 text/reasoning/tool frames, and completes exactly once', async () => {
    mocks.sendMessage.mockResolvedValue(
      sse(
        [
          '{"type":"text-start","id":"text-1"}',
          '{"type":"text-delta","id":"text-1","delta":"Hello"}',
          '{"type":"reasoning-delta","id":"reason-1","delta":"Thinking"}',
          '{"type":"tool-input-available","toolCallId":"call-1","toolName":"search","input":{"q":"x"}}',
          '{"type":"tool-output-available","toolCallId":"call-1","output":"found"}',
          '{"type":"finish"}',
          '[DONE]'
        ],
        '\r\n'
      )
    )
    const connection = await new StellaRuntimeConnection('remote-agent').start()
    const iterator = connection.events[Symbol.asyncIterator]()
    expect(await iterator.next()).toEqual({ value: { type: 'resume-token', token: 'remote-session' }, done: false })

    connection.send({ message: { data: { parts: [{ type: 'text', text: 'Hi' }] } } as never })
    const events = await Promise.all([
      iterator.next(),
      iterator.next(),
      iterator.next(),
      iterator.next(),
      iterator.next(),
      iterator.next()
    ])

    expect(mocks.sendMessage).toHaveBeenCalledWith('remote-agent', 'remote-session', 'Hi', expect.any(AbortSignal))
    expect(events.map((event) => event.value.type)).toEqual([
      'chunk',
      'chunk',
      'chunk',
      'chunk',
      'chunk',
      'turn-complete'
    ])
    expect(events[3].value.chunk.providerMetadata.cherry.transport).toBe('stella-agent')
    expect(events[4].value.chunk).toMatchObject({
      type: 'tool-output-available',
      toolCallId: 'call-1',
      output: 'found'
    })
    await connection.close()
  })

  it('aborts the in-flight fetch when stopped', async () => {
    let signal: AbortSignal | undefined
    mocks.sendMessage.mockImplementation(
      async (_agent: string, _session: string, _text: string, nextSignal: AbortSignal) => {
        signal = nextSignal
        return await new Promise<Response>(() => {})
      }
    )
    const connection = await new StellaRuntimeConnection('remote-agent', 'remote-session').start()
    connection.send({ message: { data: { parts: [{ type: 'text', text: 'Hi' }] } } as never })
    await vi.waitFor(() => expect(signal).toBeDefined())
    await connection.close()
    expect(signal?.aborted).toBe(true)
  })
})

describe('StellaRuntimeDriver', () => {
  it('accepts a model-free local reference with a remote agent id', () => {
    mocks.getAgent.mockReturnValue({
      id: 'local-agent',
      type: 'stella',
      model: null,
      configuration: { stella_remote_agent_id: 'remote-agent' }
    })
    expect(() =>
      new StellaRuntimeDriver().validateSession({ id: 'session-1', agentId: 'local-agent' } as never)
    ).not.toThrow()
  })
})
