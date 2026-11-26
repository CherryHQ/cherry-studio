import { afterEach, describe, expect, it, vi } from 'vitest'

import { openCursorSession, sendCursorTurn, type Run, type SDKAgent } from '@cherrystudio/agent-runtime-cursor'

import { acquireLocalAgentBrowserLease } from '../../../mcp/localAgentBrowserBridge'
import type { AgentRuntimeEvent, AgentRuntimeUserInput } from '../../types'
import { getCursorApiKey } from '../cursorAccount'
import { CursorConnection } from '../CursorConnection'

vi.mock('../../../agentSession/localContext', () => ({
  localContext: () => ({ id: 'local-context', backendId: 'local-backend' }),
  bindLocalContext: (id: string, nativeThreadId: string) => ({ id, backendId: 'local-backend', nativeThreadId })
}))

vi.mock('@cherrystudio/agent-runtime-cursor', () => ({
  openCursorSession: vi.fn(),
  sendCursorTurn: vi.fn()
}))

vi.mock('../cursorAccount', () => ({
  getCursorApiKey: vi.fn()
}))

vi.mock('../../../mcp/localAgentBrowserBridge', () => ({
  acquireLocalAgentBrowserLease: vi.fn()
}))

function userInput(id: string, text = 'hello'): AgentRuntimeUserInput {
  return {
    message: {
      id,
      role: 'user',
      status: 'success',
      data: { parts: [{ type: 'text', text }] }
    }
  } as unknown as AgentRuntimeUserInput
}

async function createCursorSession(nativeModel?: string) {
  vi.mocked(getCursorApiKey).mockResolvedValue('cursor-test-key')
  vi.mocked(acquireLocalAgentBrowserLease).mockResolvedValue(undefined)
  const agent: SDKAgent = {
    agentId: 'cursor-agent-1',
    model: nativeModel ? { id: nativeModel } : undefined,
    close: vi.fn(),
    send: vi.fn()
  } as unknown as SDKAgent
  vi.mocked(openCursorSession).mockResolvedValue(agent)

  const connection = new CursorConnection('session-cursor', 'agent-cursor', {
    protocol: 'cursor',
    enabled: true,
    args: [],
    env: {},
    nativeModel
  })
  const events: AgentRuntimeEvent[] = []
  const drained = (async () => {
    for await (const event of connection.events) events.push(event)
  })()

  await connection.start('/tmp/cursor-workspace')
  return {
    connection,
    events,
    closeAndDrain: async () => {
      await connection.close()
      await drained
    }
  }
}

describe('CursorConnection', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('emits local-turn-usage and confirmed context-usage when model window is known', async () => {
    const { connection, events, closeAndDrain } = await createCursorSession('claude-sonnet-4-6')
    const run: Run = {
      status: 'completed',
      wait: async () =>
        ({
          id: 'run-1',
          status: 'completed',
          model: { id: 'claude-sonnet-4-6' },
          usage: {
            inputTokens: 1200,
            outputTokens: 300,
            totalTokens: 1500
          }
        }) as unknown as Awaited<ReturnType<Run['wait']>>,
      cancel: vi.fn()
    } as unknown as Run
    vi.mocked(sendCursorTurn).mockResolvedValue(run)

    await connection.send(userInput('msg-1'))
    await closeAndDrain()

    expect(events).toContainEqual({
      type: 'local-turn-usage',
      summary: expect.objectContaining({
        nativeSessionId: 'cursor-agent-1',
        model: 'claude-sonnet-4-6',
        usage: expect.objectContaining({
          inputTokens: 1200,
          outputTokens: 300,
          totalTokens: 1500
        })
      })
    })
    expect(events).toContainEqual({
      type: 'context-usage',
      result: {
        status: 'confirmed',
        value: {
          model: 'claude-sonnet-4-6',
          revision: 'claude-sonnet-4-6',
          contextWindow: 200_000,
          basis: 'last-request',
          used: { tokens: 1200, precision: 'estimated' }
        }
      }
    })
  })

  it('emits unsupported context-usage once across multiple turns when model window is unknown', async () => {
    const { connection, events, closeAndDrain } = await createCursorSession('auto')
    const makeRun = (inputTokens: number): Run =>
      ({
        status: 'completed',
        wait: async () =>
          ({
            id: 'run-1',
            status: 'completed',
            model: { id: 'auto' },
            usage: { inputTokens, outputTokens: 50, totalTokens: inputTokens + 50 }
          }) as unknown as Awaited<ReturnType<Run['wait']>>,
        cancel: vi.fn()
      }) as unknown as Run

    vi.mocked(sendCursorTurn).mockResolvedValueOnce(makeRun(400)).mockResolvedValueOnce(makeRun(800))

    await connection.send(userInput('msg-1'))
    await connection.send(userInput('msg-2'))
    await closeAndDrain()

    const contextEvents = events.filter((event) => event.type === 'context-usage')
    expect(contextEvents).toEqual([
      {
        type: 'context-usage',
        result: {
          status: 'unsupported',
          error: {
            operation: 'contextUsage',
            code: 'unsupported',
            message: 'This agent does not report context window size'
          }
        }
      }
    ])
    expect(events.filter((event) => event.type === 'local-turn-usage')).toHaveLength(2)
  })

  it('emits unsupported context-usage once across multiple turns when usage is omitted', async () => {
    const { connection, events, closeAndDrain } = await createCursorSession('claude-sonnet-4-6')
    const makeRun = (): Run =>
      ({
        status: 'completed',
        wait: async () =>
          ({
            id: 'run-1',
            status: 'completed',
            model: { id: 'claude-sonnet-4-6' }
          }) as unknown as Awaited<ReturnType<Run['wait']>>,
        cancel: vi.fn()
      }) as unknown as Run

    vi.mocked(sendCursorTurn).mockResolvedValueOnce(makeRun()).mockResolvedValueOnce(makeRun())

    await connection.send(userInput('msg-1'))
    await connection.send(userInput('msg-2'))
    await closeAndDrain()

    const contextEvents = events.filter((event) => event.type === 'context-usage')
    expect(contextEvents).toEqual([
      {
        type: 'context-usage',
        result: {
          status: 'unsupported',
          error: {
            operation: 'contextUsage',
            code: 'unsupported',
            message: 'This agent does not report context usage'
          }
        }
      }
    ])
  })
})
