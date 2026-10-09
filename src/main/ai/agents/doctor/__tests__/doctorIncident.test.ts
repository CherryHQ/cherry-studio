import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const logsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-incident-logs-'))
afterAll(() => fs.rmSync(logsDir, { recursive: true, force: true }))

const KEY = 'sk-proj-abcdefghijklmnopqrstuvwxyz123456'

const mocks = vi.hoisted(() => ({
  sessionMessages: [] as unknown[],
  provider: { id: 'openai', isEnabled: true } as Record<string, unknown>
}))

vi.mock('@application', async () => {
  const base = (await import('@test-mocks/main/application')).mockApplicationFactory()
  return { ...base, application: { ...base.application, getPath: () => logsDir } }
})
vi.mock('@data/services/TemporaryChatService', () => ({
  temporaryChatService: { hasTopic: () => false, listMessages: () => [] }
}))
vi.mock('@data/services/AgentSessionMessageService', () => ({
  agentSessionMessageService: {
    listSessionMessages: (sessionId: string) => ({
      items: sessionId === 'session-1' ? mocks.sessionMessages : [{ id: 'other', role: 'user', data: {} }]
    })
  }
}))
vi.mock('@main/ai/messages/readConversation', () => ({
  readConversation: ({ sessionId, messageId }: { sessionId: string; messageId: string }) => ({
    source: 'agent',
    sessionId,
    message: (mocks.sessionMessages as { id: string }[]).find((message) => message.id === messageId)
  })
}))
vi.mock('@data/services/ProviderService', () => ({ providerService: { getByProviderId: () => mocks.provider } }))
vi.mock('@data/services/ModelService', () => ({ modelService: { getByKey: () => ({ id: 'openai::gpt-4o' }) } }))
vi.mock('@main/ai/provider/endpoint', () => ({
  resolveEffectiveEndpoint: (provider: { baseUrl: string }) => ({
    endpointType: 'openai-chat-completions',
    baseUrl: provider.baseUrl
  })
}))

import { incidentLogs, incidentMessages, incidentRequest } from '../doctorIncident'

const incident = { topicId: 'agent-session:session-1', messageId: 'msg-3' }

function message(id: string, role: string, text: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    role,
    status: 'success',
    createdAt: `2026-10-09T00:00:0${id.at(-1)}.000Z`,
    data: { parts: [{ type: 'text', text }] },
    ...extra
  }
}

beforeEach(() => {
  // Newest first, the order the session service returns.
  mocks.sessionMessages = [
    message('msg-4', 'user', 'after the failure'),
    message('msg-3', 'assistant', '', {
      status: 'error',
      modelId: 'openai::gpt-4o',
      data: {
        parts: [
          {
            type: 'data-error',
            data: {
              name: 'AI_APICallError',
              message: 'Unsupported parameter: reasoning_effort',
              statusCode: 400,
              url: 'https://old.example.com/v1/chat/completions',
              requestBodyValues: {
                model: 'gpt-4o',
                reasoning_effort: 'high',
                messages: [
                  { role: 'system', content: 'be brief' },
                  { role: 'user', content: `my secret plan ${KEY}` }
                ],
                tools: [{ type: 'function', function: { name: 'web_search' } }]
              }
            }
          }
        ]
      }
    }),
    message('msg-2', 'user', `question with ${KEY}`),
    message('msg-1', 'assistant', 'earlier answer')
  ]
  mocks.provider = { id: 'openai', isEnabled: true, baseUrl: 'https://new.example.com/v1' }
})

describe('incidentMessages', () => {
  it('returns the failed message and what led up to it, oldest first, never what came after', () => {
    const { messages } = incidentMessages(incident, 1) as { messages: { id: string }[] }
    expect(messages.map((item) => item.id)).toEqual(['msg-2', 'msg-3'])
  })

  it('redacts credentials inside message text', () => {
    expect(JSON.stringify(incidentMessages(incident, 5))).not.toContain(KEY)
  })
})

describe('incidentRequest', () => {
  it('describes the request without any conversation text and flags a base URL changed since the error', () => {
    const result = incidentRequest(incident) as {
      requests: { configChangedSinceError: boolean; requestShape: Record<string, unknown> }[]
    }
    const [request] = result.requests
    expect(request.configChangedSinceError).toBe(true)
    expect(request.requestShape).toMatchObject({
      messages: { count: 2, roles: { system: 1, user: 1 } },
      tools: ['web_search'],
      params: { model: 'gpt-4o', reasoning_effort: 'high' }
    })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('my secret plan')
    expect(serialized).not.toContain('be brief')
    expect(serialized).not.toContain(KEY)
  })

  it('does not flag a config change when the error went to the current base URL', () => {
    mocks.provider = { id: 'openai', isEnabled: true, baseUrl: 'https://old.example.com/v1' }
    const [request] = (incidentRequest(incident) as { requests: { configChangedSinceError: boolean }[] }).requests
    expect(request.configChangedSinceError).toBe(false)
  })
})

describe('incidentLogs', () => {
  it('keeps only lines naming this conversation, including the API gateway hop, with keys redacted', () => {
    const lines = [
      { message: 'Dispatching stream request', topicId: 'agent-session:session-1', timestamp: '2026-10-09 00:00:01' },
      { message: 'Getting session', sessionId: 'session-1', timestamp: '2026-10-09 00:00:02' },
      {
        message: 'Error in message processing',
        agentSessionId: 'session-1',
        error: `401 invalid key ${KEY}`,
        timestamp: '2026-10-09 00:00:03'
      },
      { message: 'unrelated', sessionId: 'session-2', timestamp: '2026-10-09 00:00:04' }
    ]
    fs.writeFileSync(
      path.join(logsDir, 'app.2026-10-09.log'),
      ['not json', ...lines.map((line) => JSON.stringify(line))].join('\n')
    )
    const result = incidentLogs(incident, 100) as { count: number; lines: string[] }
    expect(result.count).toBe(3)
    expect(result.lines.join('\n')).toContain('Error in message processing')
    expect(result.lines.join('\n')).not.toContain('session-2')
    expect(result.lines.join('\n')).not.toContain(KEY)
  })
})
