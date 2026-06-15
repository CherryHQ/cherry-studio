import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { assistantTable } from '@data/db/schemas/assistant'
import { knowledgeBaseTable } from '@data/db/schemas/knowledge'
import { topicTable } from '@data/db/schemas/topic'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { agentService } from '@data/services/AgentService'
import { assistantDataService } from '@data/services/AssistantService'
import { EntitySearchService } from '@data/services/EntitySearchService'
import { generateOrderKeySequence } from '@data/services/utils/orderKey'
import { ENTITY_SEARCH_MAX_LIMIT_PER_TYPE, EntitySearchQuerySchema } from '@shared/data/api/schemas/search'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import { createUniqueModelId } from '@shared/data/types/model'
import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('EntitySearchService', () => {
  const dbh = setupTestDatabase()
  let service: EntitySearchService

  beforeEach(async () => {
    service = new EntitySearchService()
    await seedModelRefs()
  })

  afterEach(() => {
    vi.restoreAllMocks()
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

  async function seedSession(values: Omit<typeof agentSessionTable.$inferInsert, 'workspaceId'>) {
    const workspaceId = `workspace-${values.id}`
    await dbh.db.insert(agentWorkspaceTable).values({
      id: workspaceId,
      name: workspaceId,
      path: `/tmp/${workspaceId}`,
      type: 'user',
      orderKey: `workspace-${values.orderKey}`
    })
    await dbh.db.insert(agentSessionTable).values({ ...values, workspaceId })
  }

  async function seedEntitySearchRows() {
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
      configuration: { avatar: '🧠' },
      orderKey: 'a0'
    })
    await dbh.db.insert(topicTable).values({
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Needle Topic',
      assistantId: '11111111-1111-4111-8111-111111111111',
      orderKey: 'a0'
    })
    await seedSession({
      id: '44444444-4444-4444-8444-444444444444',
      agentId: '22222222-2222-4222-8222-222222222222',
      name: 'Needle Session',
      description: 'Session result',
      orderKey: 'a0'
    })
    await dbh.db.insert(knowledgeBaseTable).values({
      id: '55555555-5555-4555-8555-555555555555',
      name: 'Needle Knowledge',
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
      searchMode: 'vector'
    })
  }

  it('aggregates all supported entity types into read-model groups', async () => {
    await seedEntitySearchRows()

    const result = await service.search(EntitySearchQuerySchema.parse({ q: 'Needle', limitPerType: 5 }))

    expect(result.query).toBe('Needle')
    expect(result).not.toHaveProperty('messageItems')
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
          emoji: '🌟',
          target: { assistantId: '11111111-1111-4111-8111-111111111111' }
        })
      ],
      [
        expect.objectContaining({
          type: 'agent',
          id: '22222222-2222-4222-8222-222222222222',
          title: 'Needle Agent',
          emoji: '🧠',
          target: { agentId: '22222222-2222-4222-8222-222222222222' }
        })
      ],
      [
        expect.objectContaining({
          type: 'topic',
          id: '33333333-3333-4333-8333-333333333333',
          title: 'Needle Topic',
          subtitle: 'Needle Assistant',
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
          subtitle: 'Needle Agent',
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
    await seedEntitySearchRows()
    await seedSession({
      id: '66666666-6666-4666-8666-666666666666',
      agentId: '22222222-2222-4222-8222-222222222222',
      name: 'Needle Follow-up',
      description: '',
      orderKey: 'a1'
    })

    const result = await service.search(
      EntitySearchQuerySchema.parse({ q: 'Needle', types: ['session'], limitPerType: 1 })
    )

    expect(result.groups).toHaveLength(1)
    expect(result.groups[0].type).toBe('session')
    expect(result.groups[0].items).toHaveLength(1)
  })

  it('fails the full query with type context when one entity type fails', async () => {
    vi.spyOn(assistantDataService, 'search').mockRejectedValueOnce(new Error('database is busy'))
    const agentSearch = vi.spyOn(agentService, 'search').mockResolvedValueOnce([])

    await expect(
      service.search(EntitySearchQuerySchema.parse({ q: 'Needle', types: ['assistant', 'agent'], limitPerType: 5 }))
    ).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: expect.stringContaining('entity search type assistant')
    })

    expect(agentSearch).toHaveBeenCalled()
  })

  it('clamps direct service limitPerType above the maximum', async () => {
    const assistantSearch = vi.spyOn(assistantDataService, 'search').mockResolvedValueOnce([])

    await service.search({
      q: 'Needle',
      types: ['assistant'],
      limitPerType: ENTITY_SEARCH_MAX_LIMIT_PER_TYPE + 1
    })

    expect(assistantSearch).toHaveBeenCalledWith({
      q: 'Needle',
      limit: ENTITY_SEARCH_MAX_LIMIT_PER_TYPE,
      updatedAtFrom: undefined
    })
  })

  it('orders assistant matches by updatedAt', async () => {
    await seedEntitySearchRows()
    const oldUpdatedAt = Date.parse('2026-04-01T00:00:00.000Z')
    const freshUpdatedAt = Date.parse('2026-05-10T00:00:00.000Z')

    await dbh.db.update(assistantTable).set({ updatedAt: oldUpdatedAt })
    await dbh.db.insert(assistantTable).values({
      id: '77777777-7777-4777-8777-777777777777',
      name: 'Needle Fresh Assistant',
      prompt: '',
      emoji: '✨',
      description: 'Fresh assistant result',
      modelId: null,
      settings: DEFAULT_ASSISTANT_SETTINGS,
      orderKey: 'a1',
      updatedAt: freshUpdatedAt
    })

    const result = await service.search(
      EntitySearchQuerySchema.parse({ q: 'Needle', types: ['assistant'], limitPerType: 5 })
    )

    expect(result.groups[0].items.map((item) => item.id)).toEqual([
      '77777777-7777-4777-8777-777777777777',
      '11111111-1111-4111-8111-111111111111'
    ])
  })

  it('filters matches by updatedAtFrom when provided', async () => {
    await seedEntitySearchRows()
    const oldUpdatedAt = Date.parse('2026-04-01T00:00:00.000Z')
    const freshUpdatedAt = Date.parse('2026-05-10T00:00:00.000Z')

    await dbh.db.update(assistantTable).set({ updatedAt: oldUpdatedAt })
    await dbh.db.insert(assistantTable).values({
      id: '77777777-7777-4777-8777-777777777777',
      name: 'Needle Fresh Assistant',
      prompt: '',
      emoji: '✨',
      description: 'Fresh assistant result',
      modelId: null,
      settings: DEFAULT_ASSISTANT_SETTINGS,
      orderKey: 'a1',
      updatedAt: freshUpdatedAt
    })

    const result = await service.search(
      EntitySearchQuerySchema.parse({
        q: 'Needle',
        types: ['assistant'],
        limitPerType: 5,
        updatedAtFrom: '2026-05-01T00:00:00.000Z'
      })
    )

    expect(result.groups).toEqual([
      {
        type: 'assistant',
        items: [
          expect.objectContaining({
            id: '77777777-7777-4777-8777-777777777777',
            title: 'Needle Fresh Assistant',
            updatedAt: '2026-05-10T00:00:00.000Z'
          })
        ]
      }
    ])
  })

  it('returns empty item groups when no entity matches', async () => {
    const result = await service.search(EntitySearchQuerySchema.parse({ q: 'missing', limitPerType: 2 }))

    expect(result.groups.map((group) => [group.type, group.items])).toEqual([
      ['assistant', []],
      ['agent', []],
      ['topic', []],
      ['session', []],
      ['knowledge-base', []]
    ])
  })
})
