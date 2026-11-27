import type { LanguageModelV3 } from '@ai-sdk/provider'
import { setupTestDatabase, withRoot } from '@test-helpers/db'
import { APICallError } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { messageService } from '@data/services/MessageService'
import { DEFAULT_CONTEXT_SETTINGS } from '@shared/data/types/contextSettings'
import { createUniqueModelId, type Model } from '@shared/data/types/model'

const { resolveSettings } = vi.hoisted(() => ({ resolveSettings: vi.fn() }))
vi.mock('../../../contextBuild/resolveRequestContextSettings', () => ({
  resolveRequestContextSettings: resolveSettings
}))

import { PersistentChatContextProvider } from '../PersistentChatContextProvider'

describe('persistent compaction overflow', () => {
  const dbh = setupTestDatabase()

  it('keeps the stored history and boundary when the summarizer cannot fit its input', async () => {
    await dbh.db.insert(topicTable).values({ id: 'topic', activeNodeId: 'u2', orderKey: 'a0' })
    await dbh.db.insert(messageTable).values(
      withRoot('topic', [
        {
          id: 'u1',
          parentId: null,
          topicId: 'topic',
          role: 'user',
          data: { parts: [{ type: 'text', text: 'old '.repeat(12_000) }] },
          status: 'success',
          siblingsGroupId: 0,
          createdAt: 1,
          updatedAt: 1
        },
        {
          id: 'a1',
          parentId: 'u1',
          topicId: 'topic',
          role: 'assistant',
          data: { parts: [{ type: 'text', text: 'old response' }] },
          status: 'success',
          siblingsGroupId: 1,
          createdAt: 2,
          updatedAt: 2
        },
        {
          id: 'u2',
          parentId: 'a1',
          topicId: 'topic',
          role: 'user',
          data: { parts: [{ type: 'text', text: 'current question' }] },
          status: 'success',
          siblingsGroupId: 0,
          createdAt: 3,
          updatedAt: 3
        }
      ])
    )
    let attempts = 0
    const compressor: LanguageModelV3 = {
      specificationVersion: 'v3',
      provider: 'test',
      modelId: 'compressor',
      supportedUrls: {},
      async doGenerate() {
        attempts++
        throw new APICallError({
          message: 'context_length_exceeded',
          statusCode: 400,
          url: 'test',
          requestBodyValues: {}
        })
      },
      async doStream() {
        throw new Error('not used')
      }
    }
    resolveSettings.mockResolvedValue({
      contextSettings: DEFAULT_CONTEXT_SETTINGS,
      compressionModel: { languageModel: compressor, contextWindow: 16_000 }
    })
    const model = { id: createUniqueModelId('test', 'chat'), providerId: 'test', contextWindow: 4000 } as Model
    const provider = new PersistentChatContextProvider()
    const result = await provider['resolveCompactedHistory']('u2', 'topic', [model], undefined)

    expect(attempts).toBeGreaterThan(0)
    expect(result.messages.map((message) => message.id)).toEqual(['u1', 'a1', 'u2'])
    expect(messageService.getPathToNode('u2').map((message) => message.compactionSummary)).toEqual([null, null, null])
    expect(messageService.getById('u1').data.parts?.[0]).toEqual({ type: 'text', text: 'old '.repeat(12_000) })
    const reopened = await new PersistentChatContextProvider()['resolveCompactedHistory'](
      'u2',
      'topic',
      [model],
      undefined
    )
    expect(reopened.messages.map((message) => message.id)).toEqual(['u1', 'a1', 'u2'])
  })
})
