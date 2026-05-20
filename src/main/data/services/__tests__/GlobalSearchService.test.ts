import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { assistantTable } from '@data/db/schemas/assistant'
import { knowledgeBaseTable } from '@data/db/schemas/knowledge'
import { topicTable } from '@data/db/schemas/topic'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { GlobalSearchService } from '@data/services/GlobalSearchService'
import { generateOrderKeySequence } from '@data/services/utils/orderKey'
import { GlobalSearchQuerySchema } from '@shared/data/api/schemas/globalSearch'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import { createUniqueModelId } from '@shared/data/types/model'
import { setupTestDatabase } from '@test-helpers/db'
import { beforeEach, describe, expect, it } from 'vitest'

describe('GlobalSearchService', () => {
  const dbh = setupTestDatabase()
  let service: GlobalSearchService

  beforeEach(async () => {
    service = new GlobalSearchService()
    await seedModelRefs()
  })

  async function seedModelRefs() {
    const [providerKey, modelKey] = generateOrderKeySequence(2)
    await dbh.db.insert(userProviderTable).values([{ providerId: 'openai', name: 'OpenAI', orderKey: providerKey }])
    await dbh.db.insert(userModelTable).values([
      {
        id: createUniqueModelId('openai', 'embed-model'),
        providerId: 'openai',
        modelId: 'embed-model',
        presetModelId: 'embed-model',
        name: 'embed-model',
        isEnabled: true,
        isHidden: false,
        orderKey: modelKey
      }
    ])
  }

  async function seedGlobalSearchRows() {
    await dbh.db.insert(assistantTable).values({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Needle Assistant',
      prompt: '',
      emoji: '🌟',
      description: 'Assistant result',
      modelId: null,
      settings: DEFAULT_ASSISTANT_SETTINGS,
      orderKey: 'a0'
    })
    await dbh.db.insert(agentTable).values({
      id: '22222222-2222-4222-8222-222222222222',
      type: 'claude-code',
      name: 'Needle Agent',
      description: 'Agent result',
      instructions: 'Help',
      model: null,
      orderKey: 'a0'
    })
    await dbh.db.insert(topicTable).values({
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Needle Topic',
      assistantId: '11111111-1111-4111-8111-111111111111',
      orderKey: 'a0'
    })
    await dbh.db.insert(agentSessionTable).values({
      id: '44444444-4444-4444-8444-444444444444',
      agentId: '22222222-2222-4222-8222-222222222222',
      name: 'Needle Session',
      description: 'Session result',
      orderKey: 'a0'
    })
    await dbh.db.insert(knowledgeBaseTable).values({
      id: '55555555-5555-4555-8555-555555555555',
      name: 'Needle Knowledge',
      emoji: '📁',
      dimensions: 1536,
      embeddingModelId: createUniqueModelId('openai', 'embed-model'),
      status: 'completed',
      error: null,
      rerankModelId: null,
      fileProcessorId: null,
      chunkSize: 800,
      chunkOverlap: 120,
      threshold: null,
      documentCount: null,
      searchMode: 'default',
      hybridAlpha: null
    })
  }

  it('aggregates all supported entity types into read-model groups', async () => {
    await seedGlobalSearchRows()

    const result = await service.search(GlobalSearchQuerySchema.parse({ q: 'Needle', limitPerType: 5 }))

    expect(result.query).toBe('Needle')
    expect(result.groups.map((group) => group.type)).toEqual([
      'assistant',
      'agent',
      'topic',
      'session',
      'knowledge-base'
    ])
    expect(result.groups.map((group) => group.items)).toEqual([
      [
        expect.objectContaining({
          type: 'assistant',
          id: '11111111-1111-4111-8111-111111111111',
          title: 'Needle Assistant',
          target: { assistantId: '11111111-1111-4111-8111-111111111111' }
        })
      ],
      [
        expect.objectContaining({
          type: 'agent',
          id: '22222222-2222-4222-8222-222222222222',
          title: 'Needle Agent',
          target: { agentId: '22222222-2222-4222-8222-222222222222' }
        })
      ],
      [
        expect.objectContaining({
          type: 'topic',
          id: '33333333-3333-4333-8333-333333333333',
          title: 'Needle Topic',
          target: {
            topicId: '33333333-3333-4333-8333-333333333333',
            assistantId: '11111111-1111-4111-8111-111111111111'
          }
        })
      ],
      [
        expect.objectContaining({
          type: 'session',
          id: '44444444-4444-4444-8444-444444444444',
          title: 'Needle Session',
          target: {
            sessionId: '44444444-4444-4444-8444-444444444444',
            agentId: '22222222-2222-4222-8222-222222222222'
          }
        })
      ],
      [
        expect.objectContaining({
          type: 'knowledge-base',
          id: '55555555-5555-4555-8555-555555555555',
          title: 'Needle Knowledge',
          target: {
            knowledgeBaseId: '55555555-5555-4555-8555-555555555555'
          }
        })
      ]
    ])
  })

  it('honors type filters and limitPerType', async () => {
    await seedGlobalSearchRows()
    await dbh.db.insert(agentSessionTable).values({
      id: '66666666-6666-4666-8666-666666666666',
      agentId: '22222222-2222-4222-8222-222222222222',
      name: 'Needle Follow-up',
      description: '',
      orderKey: 'a1'
    })

    const result = await service.search(
      GlobalSearchQuerySchema.parse({ q: 'Needle', types: ['session'], limitPerType: 1 })
    )

    expect(result.groups).toHaveLength(1)
    expect(result.groups[0].type).toBe('session')
    expect(result.groups[0].items).toHaveLength(1)
  })

  it('returns empty item groups when no entity matches', async () => {
    const result = await service.search(GlobalSearchQuerySchema.parse({ q: 'missing', limitPerType: 2 }))

    expect(result.groups.map((group) => [group.type, group.items])).toEqual([
      ['assistant', []],
      ['agent', []],
      ['topic', []],
      ['session', []],
      ['knowledge-base', []]
    ])
  })
})
