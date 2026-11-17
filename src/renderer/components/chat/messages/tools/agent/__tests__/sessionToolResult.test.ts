import { describe, expect, it } from 'vitest'

import {
  getSessionCreateTargetAgentName,
  getSessionToolTargets,
  MAX_SESSION_SEARCH_RESULT_CARDS,
  parseSessionCreateResult,
  parseSessionReadResult,
  parseSessionSearchResult
} from '../sessionToolResult'

function toolResponse(name: string, serverId?: string) {
  return {
    id: `response-${name}`,
    toolCallId: `call-${name}`,
    tool: { id: name, name, type: serverId ? 'mcp' : 'provider', ...(serverId ? { serverId } : {}) },
    arguments: { title: 'Research session' },
    status: 'done',
    response: JSON.stringify({ ok: true, sessionId: 'session-research' })
  } as never
}

describe('getSessionToolTargets', () => {
  it('matches Cherry Session tools by exact identity', () => {
    expect(getSessionToolTargets(toolResponse('session_create'))).toMatchObject([
      {
        renderKey: 'call-session_create',
        sessionId: 'session-research',
        sessionName: 'Research session'
      }
    ])
    expect(getSessionToolTargets(toolResponse('session_create', 'cherry-tools'))).toHaveLength(1)
  })

  it("does not treat another MCP server's same-named tool as a Cherry Session action", () => {
    expect(getSessionToolTargets(toolResponse('session_create', 'tmux'))).toEqual([])
  })

  it('names the target Agent for a cross-Agent create', () => {
    const response = toolResponse('session_create') as any
    response.response = JSON.stringify({
      ok: true,
      agentId: 'agent-b',
      sessionId: 'session-research',
      delivery: {
        sender: { agentId: 'agent-a' },
        receiver: { agentId: 'agent-b' },
        receiverSnapshot: { agentName: ' Various Scripts ', sessionName: 'Research session' }
      }
    })

    expect(getSessionToolTargets(response)[0].agentName).toBe('Various Scripts')
  })

  it('omits the Agent name for a same-Agent create even with a snapshot', () => {
    const response = toolResponse('session_create') as any
    response.response = JSON.stringify({
      ok: true,
      sessionId: 'session-research',
      delivery: {
        sender: { agentId: 'agent-a' },
        receiver: { agentId: 'agent-a' },
        receiverSnapshot: { agentName: 'Various Scripts' }
      }
    })

    expect(getSessionToolTargets(response)[0].agentName).toBeUndefined()
  })

  it('keeps legacy create results openable without an Agent name', () => {
    const response = toolResponse('session_create') as any
    response.response = JSON.stringify({
      ok: true,
      sessionId: 'session-research',
      delivery: { status: 'delivering' }
    })

    const targets = getSessionToolTargets(response)
    expect(targets[0].sessionId).toBe('session-research')
    expect(targets[0].agentName).toBeUndefined()
  })

  it('leaves an untitled send target empty for the localized renderer fallback', () => {
    const response = toolResponse('session_send', 'cherry-tools') as any
    response.response = JSON.stringify({
      ok: true,
      delivery: {
        receiver: { sessionId: 'opaque-id' },
        receiverSnapshot: { sessionName: '' }
      }
    })

    expect(getSessionToolTargets(response)).toMatchObject([{ sessionId: 'opaque-id', sessionName: '' }])
  })

  it('turns session_search results into openable targets, dropping the current session', () => {
    const response = toolResponse('session_search', 'cherry-tools') as any
    response.response = JSON.stringify({
      sessions: [
        { sessionId: 'current-one', sessionName: 'This session', isCurrent: true },
        { sessionId: 'session-a', sessionName: 'Session A', agentName: 'Builder' },
        { sessionId: 'session-b', sessionName: 'Session B' },
        { sessionId: 'not-a-session' }
      ]
    })

    expect(getSessionToolTargets(response)).toEqual([
      {
        agentName: 'Builder',
        conversationType: 'agent',
        kind: 'search',
        renderKey: 'call-session_search:session-a',
        sessionId: 'session-a',
        sessionName: 'Session A'
      },
      {
        agentName: undefined,
        conversationType: 'agent',
        kind: 'search',
        renderKey: 'call-session_search:session-b',
        sessionId: 'session-b',
        sessionName: 'Session B'
      }
    ])
  })

  it(`caps session_search cards at ${MAX_SESSION_SEARCH_RESULT_CARDS}`, () => {
    const response = toolResponse('session_search', 'cherry-tools') as any
    response.response = JSON.stringify({
      sessions: Array.from({ length: 6 }, (_, index) => ({
        sessionId: `session-${index}`,
        sessionName: `Session ${index}`
      }))
    })

    // The parser keeps every match so the agent's text reply can still list them all.
    expect(parseSessionSearchResult(JSON.parse(response.response))).toHaveLength(6)
    // Only the first few may become cards, or a busy search floods the reply.
    expect(getSessionToolTargets(response).map((target) => target.sessionId)).toEqual([
      'session-0',
      'session-1',
      'session-2'
    ])
  })

  it('maps session_read onto the matching conversation surface', () => {
    const agentResponse = toolResponse('session_read', 'cherry-tools') as any
    agentResponse.response = JSON.stringify({ source: 'agent', sessionId: 'agent-session', messages: [] })
    expect(getSessionToolTargets(agentResponse)).toEqual([
      {
        conversationType: 'agent',
        kind: 'read',
        renderKey: 'call-session_read',
        sessionId: 'agent-session',
        sessionName: ''
      }
    ])

    const topicResponse = toolResponse('session_read', 'cherry-tools') as any
    topicResponse.response = JSON.stringify({ source: 'topic', sessionId: 'chat-topic', messages: [] })
    expect(getSessionToolTargets(topicResponse)).toMatchObject([
      { conversationType: 'assistant', sessionId: 'chat-topic' }
    ])
  })

  it('renders no read target for temporary conversations', () => {
    expect(parseSessionReadResult({ source: 'temporary', sessionId: 'temp-id', messages: [] })).toBeUndefined()
    expect(parseSessionReadResult({ source: 'unknown', sessionId: 'x' })).toBeUndefined()
    expect(parseSessionReadResult({ sessionId: 'x' })).toBeUndefined()
  })
})

describe('session_create ownership', () => {
  it.each([
    {
      name: 'uses the top-level Agent id when the receiver id is absent',
      delivery: { sender: { agentId: 'agent-a' }, receiverSnapshot: { agentName: 'Various Scripts' } },
      expected: 'Various Scripts'
    },
    {
      name: 'prefers the receiver id over the top-level Agent id',
      delivery: {
        sender: { agentId: 'agent-a' },
        receiver: { agentId: 'agent-a' },
        receiverSnapshot: { agentName: 'Various Scripts' }
      },
      expected: undefined
    },
    {
      name: 'does not infer cross-Agent ownership without a sender id',
      delivery: { receiver: { agentId: 'agent-b' }, receiverSnapshot: { agentName: 'Various Scripts' } },
      expected: undefined
    },
    {
      name: 'does not expose a blank Agent name',
      delivery: {
        sender: { agentId: 'agent-a' },
        receiver: { agentId: 'agent-b' },
        receiverSnapshot: { agentName: '  ' }
      },
      expected: undefined
    }
  ])('$name', ({ delivery, expected }) => {
    const result = parseSessionCreateResult({ ok: true, agentId: 'agent-b', sessionId: 'session-research', delivery })

    expect(getSessionCreateTargetAgentName(result)).toBe(expected)
  })

  it('drops invalid ownership fields while preserving valid create result fields', () => {
    const result = parseSessionCreateResult({
      ok: true,
      sessionId: 'session-research',
      agentId: 42,
      delivery: {
        status: 'delivering',
        sender: { agentId: null },
        receiver: [],
        receiverSnapshot: { agentName: 42, sessionName: 'Research session' }
      }
    })

    expect(result?.sessionId).toBe('session-research')
    expect(result?.delivery?.status).toBe('delivering')
    expect(result?.agentId).toBeUndefined()
    expect(getSessionCreateTargetAgentName(result)).toBeUndefined()
    expect(parseSessionCreateResult('{invalid JSON')).toBeUndefined()
    expect(parseSessionCreateResult({ ok: true })).toBeUndefined()
  })
})
