import { dataApiService } from '@data/DataApiService'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessions'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@data/DataApiService', () => ({
  dataApiService: {
    get: vi.fn()
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn()
    })
  }
}))

vi.mock('@renderer/services/ExportService', () => ({
  exportMarkdownContentAsFile: vi.fn(),
  messagesToMarkdown: vi.fn()
}))

vi.mock('@renderer/utils/export', () => ({
  messagesToPlainText: vi.fn()
}))

vi.mock('@renderer/utils/markdown', () => ({
  markdownToPlainText: vi.fn((value: string) => value)
}))

const { getAgentSessionMessagesForExport } = await import('../AgentSessionExportService')

function createSessionMessage(
  overrides: Partial<AgentSessionMessageEntity> & Pick<AgentSessionMessageEntity, 'id' | 'role'>
): AgentSessionMessageEntity {
  const { id, role, ...rest } = overrides

  return {
    id,
    sessionId: 'session-a',
    role,
    data: { parts: [{ type: 'text', text: id }] },
    searchableText: id,
    runtimeResumeToken: null,
    status: 'success',
    modelId: null,
    modelSnapshot: null,
    stats: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...rest
  } as AgentSessionMessageEntity
}

describe('AgentSessionExportService', () => {
  beforeEach(() => {
    vi.mocked(dataApiService.get).mockReset()
  })

  it('uses the agent model fallback for assistant messages with a null model snapshot', async () => {
    vi.mocked(dataApiService.get).mockResolvedValueOnce({
      items: [
        createSessionMessage({ id: 'assistant-without-snapshot', role: 'assistant' }),
        createSessionMessage({ id: 'user-without-snapshot', role: 'user' }),
        createSessionMessage({
          id: 'assistant-with-snapshot',
          role: 'assistant',
          modelSnapshot: {
            id: 'stored-model',
            name: 'Stored Model',
            provider: 'stored-provider'
          }
        })
      ],
      nextCursor: undefined
    })

    const messages = await getAgentSessionMessagesForExport(
      { id: 'session-a', agentId: 'agent-a', name: 'Session A' },
      {
        modelFallback: {
          id: 'fallback-model',
          name: 'Fallback Model',
          provider: 'fallback-provider'
        }
      }
    )

    const modelByMessageId = new Map(messages.map((message) => [message.id, message.model]))
    expect(modelByMessageId.get('assistant-without-snapshot')).toEqual({
      id: 'fallback-model',
      name: 'Fallback Model',
      provider: 'fallback-provider',
      group: ''
    })
    expect(modelByMessageId.get('user-without-snapshot')).toBeUndefined()
    expect(modelByMessageId.get('assistant-with-snapshot')).toEqual({
      id: 'stored-model',
      name: 'Stored Model',
      provider: 'stored-provider',
      group: ''
    })
  })
})
