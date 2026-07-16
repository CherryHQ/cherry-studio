import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessions'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentRuntimeUserInput } from '../types'

const mocks = vi.hoisted(() => ({
  listRuntimeHistory: vi.fn()
}))

vi.mock('@data/services/AgentSessionMessageService', () => ({
  agentSessionMessageService: { listRuntimeHistory: mocks.listRuntimeHistory }
}))

const { buildTurnMessages } = await import('./sessionHistory')

function makeRow(overrides: Partial<AgentSessionMessageEntity>): AgentSessionMessageEntity {
  return {
    id: 'row-1',
    sessionId: 'sess-1',
    role: 'user',
    data: { parts: [{ type: 'text', text: 'hello' }] },
    status: 'success',
    searchableText: '',
    modelId: null,
    messageSnapshot: null,
    stats: null,
    runtimeResumeToken: null,
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
    ...overrides
  } as AgentSessionMessageEntity
}

function userInput(overrides: Partial<AgentSessionMessageEntity>, systemReminder = false): AgentRuntimeUserInput {
  return { message: makeRow(overrides), systemReminder }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.listRuntimeHistory.mockReturnValue([])
})

describe('buildTurnMessages', () => {
  it('queries history strictly before the incoming row and appends the prompt exactly once', () => {
    mocks.listRuntimeHistory.mockReturnValue([
      makeRow({ id: 'u1', role: 'user' }),
      makeRow({ id: 'a1', role: 'assistant', data: { parts: [{ type: 'text', text: 'earlier answer' }] } })
    ])

    const messages = buildTurnMessages(
      'sess-1',
      userInput({ id: 'u2', data: { parts: [{ type: 'text', text: 'now' }] } })
    )

    expect(mocks.listRuntimeHistory).toHaveBeenCalledWith('sess-1', { beforeMessageId: 'u2' })
    expect(messages.map((message) => message.id)).toEqual(['u1', 'a1', 'u2'])
    expect(messages.filter((message) => message.id === 'u2')).toHaveLength(1)
  })

  it('keeps assistant tool parts verbatim so completed calls replay', () => {
    const toolPart = {
      type: 'tool-read',
      toolCallId: 'call-1',
      state: 'output-available',
      input: { path: 'a.txt' },
      output: 'contents'
    }
    mocks.listRuntimeHistory.mockReturnValue([
      makeRow({ id: 'a1', role: 'assistant', data: { parts: [toolPart] } as AgentSessionMessageEntity['data'] })
    ])

    const [assistant] = buildTurnMessages('sess-1', userInput({ id: 'u2' }))

    expect(assistant.parts).toEqual([toolPart])
  })

  it('flattens user attachments to absolute paths (filesystem-agent rule)', () => {
    mocks.listRuntimeHistory.mockReturnValue([
      makeRow({
        id: 'u1',
        role: 'user',
        data: {
          parts: [
            { type: 'text', text: 'see file' },
            { type: 'file', url: 'file:///tmp/report.pdf', mediaType: 'application/pdf' }
          ]
        } as AgentSessionMessageEntity['data']
      })
    ])

    const [user] = buildTurnMessages('sess-1', userInput({ id: 'u2' }))

    expect(user.parts).toHaveLength(1)
    const [part] = user.parts as [{ type: 'text'; text: string }]
    expect(part.type).toBe('text')
    expect(part.text).toContain('see file')
    expect(part.text).toContain('/tmp/report.pdf')
  })

  it('wraps a systemReminder prompt as a steer redirect', () => {
    const messages = buildTurnMessages(
      'sess-1',
      userInput({ id: 'u2', data: { parts: [{ type: 'text', text: 'change course' }] } }, true)
    )

    const [prompt] = messages.slice(-1) as unknown as [{ parts: [{ type: 'text'; text: string }] }]
    expect(prompt.parts[0].text).toContain('system-reminder')
    expect(prompt.parts[0].text).toContain('change course')
  })

  it('sanitizes unresolved approval states to output-denied on replay', () => {
    mocks.listRuntimeHistory.mockReturnValue([
      makeRow({
        id: 'a1',
        role: 'assistant',
        data: {
          parts: [
            {
              type: 'tool-write',
              toolCallId: 'call-1',
              state: 'approval-requested',
              input: { path: 'a.txt' },
              approval: { id: 'appr-1' }
            },
            {
              type: 'dynamic-tool',
              toolName: 'mcp_thing',
              toolCallId: 'call-2',
              state: 'approval-responded',
              input: {},
              approval: { id: 'appr-2', approved: true }
            }
          ]
        } as AgentSessionMessageEntity['data']
      })
    ])

    const [assistant] = buildTurnMessages('sess-1', userInput({ id: 'u2' }))
    const parts = assistant.parts as Array<{ state: string; approval: { approved: boolean; reason?: string } }>

    for (const part of parts) {
      expect(part.state).toBe('output-denied')
      expect(part.approval.approved).toBe(false)
      expect(part.approval.reason).toContain('not resolved')
    }
  })

  it('keeps terminal approval states verbatim', () => {
    const executed = {
      type: 'tool-write',
      toolCallId: 'call-1',
      state: 'output-available',
      input: { path: 'a.txt' },
      output: 'ok',
      approval: { id: 'appr-1', approved: true }
    }
    mocks.listRuntimeHistory.mockReturnValue([
      makeRow({ id: 'a1', role: 'assistant', data: { parts: [executed] } as AgentSessionMessageEntity['data'] })
    ])

    const [assistant] = buildTurnMessages('sess-1', userInput({ id: 'u2' }))

    expect(assistant.parts).toEqual([executed])
  })

  it('propagates the missing-boundary error: no synthetic-turn fallback', () => {
    mocks.listRuntimeHistory.mockImplementation(() => {
      throw new Error('Message not found')
    })

    expect(() => buildTurnMessages('sess-1', userInput({ id: 'ghost' }))).toThrowError('Message not found')
  })
})
