import { describe, expect, it } from 'vitest'

import { getSessionToolTarget } from '../sessionToolResult'

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

describe('getSessionToolTarget', () => {
  it('matches Cherry Session tools by exact identity', () => {
    expect(getSessionToolTarget(toolResponse('session_create'))).toMatchObject({
      renderKey: 'call-session_create',
      sessionId: 'session-research',
      sessionName: 'Research session'
    })
    expect(getSessionToolTarget(toolResponse('session_create', 'cherry-tools'))).toBeDefined()
  })

  it("does not treat another MCP server's same-named tool as a Cherry Session action", () => {
    expect(getSessionToolTarget(toolResponse('session_create', 'tmux'))).toBeUndefined()
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

    expect(getSessionToolTarget(response)).toMatchObject({ sessionId: 'opaque-id', sessionName: '' })
  })
})
