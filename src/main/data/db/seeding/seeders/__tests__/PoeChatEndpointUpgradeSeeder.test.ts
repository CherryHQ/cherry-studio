import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Use bundled registry data rather than the application mock's /mock paths.
vi.mock('@main/data/services/utils/registryDataPaths', () => ({
  resolveRegistryPaths: () => ({
    models: `${process.cwd()}/packages/provider-registry/data/models.json`,
    providers: `${process.cwd()}/packages/provider-registry/data/providers.json`,
    providerModels: `${process.cwd()}/packages/provider-registry/data/provider-models.json`
  })
}))

import { pinTable } from '@data/db/schemas/pin'
import { userModelTable, type InsertUserModelRow } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { resolveEffectiveEndpoint } from '@main/ai/provider/endpoint'
import { createUniqueModelId, ENDPOINT_TYPE } from '@shared/data/types/model'

import { PoeChatEndpointUpgradeSeeder } from '../PoeChatEndpointUpgradeSeeder'

const CORRECTION_IDS = [
  'claude-sonnet-5.5',
  'gemini-3.5-flash-lite',
  'gemini-3.6-flash',
  'gemini-3.7-flash',
  'gemini-3.8-flash',
  'gpt-4o-search',
  'grok-4.3',
  'grok-4.5',
  'grok-4.6',
  'grok-4.7',
  'mistral-large-2',
  'mistral-medium',
  'mistral-small-3',
  'perplexity-adv-deep-research',
  'solar-pro-2'
]

function modelRow(providerId: string, modelId: string, values: Partial<InsertUserModelRow> = {}): InsertUserModelRow {
  return {
    id: createUniqueModelId(providerId, modelId),
    providerId,
    modelId,
    name: 'My bot',
    capabilities: [],
    supportsStreaming: true,
    orderKey: 'a0',
    notes: 'Keep notes',
    isEnabled: false,
    isHidden: true,
    isDeprecated: true,
    ...values
  }
}

describe('Poe historical chat endpoint repair', () => {
  const dbh = setupTestDatabase()
  beforeEach(() => vi.stubEnv('CHERRY_EDITION', 'global'))
  afterEach(() => vi.unstubAllEnvs())

  it('repairs every exact correction id, preserves model state and pins, and is idempotent', () => {
    const db = dbh.db
    db.insert(userProviderTable)
      .values({ providerId: 'poe', presetProviderId: 'poe', name: 'Poe', orderKey: 'a0' })
      .run()
    db.insert(userModelTable)
      .values(
        CORRECTION_IDS.map((id, index) =>
          modelRow('poe', id, {
            orderKey: `a${index.toString(36)}`,
            endpointTypes: index % 2 ? [] : null
          })
        )
      )
      .run()
    const id = createUniqueModelId('poe', 'perplexity-adv-deep-research')
    db.insert(pinTable).values({ entityType: 'model', entityId: id, orderKey: 'a0' }).run()
    const before = db.select().from(userModelTable).all()
    const pins = db.select().from(pinTable).all()
    const providers = db.select().from(userProviderTable).all()
    expect(
      resolveEffectiveEndpoint(
        providerService.getByProviderId('poe'),
        modelService.getByKey('poe', 'perplexity-adv-deep-research')
      ).endpointType
    ).toBe(ENDPOINT_TYPE.OPENAI_RESPONSES)
    const seeder = new PoeChatEndpointUpgradeSeeder()
    seeder.run(db)
    const after = db.select().from(userModelTable).all()
    for (const row of after) {
      const original = before.find((item) => item.id === row.id)!
      expect(row).toEqual({
        ...original,
        endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS],
        updatedAt: row.updatedAt
      })
    }
    expect(db.select().from(pinTable).all()).toEqual(pins)
    expect(db.select().from(userProviderTable).all()).toEqual(providers)
    const model = modelService.getByKey('poe', 'perplexity-adv-deep-research')
    expect(model.endpointTypes).toEqual([ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS])
    expect(resolveEffectiveEndpoint(providerService.getByProviderId('poe'), model).endpointType).toBe(
      ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
    )
    seeder.run(db)
    expect(db.select().from(userModelTable).all()).toEqual(after)
  })

  it('preserves explicit endpoints, unrelated ids/providers, clones and provider rows', () => {
    const db = dbh.db
    db.insert(userProviderTable)
      .values([
        { providerId: 'poe', presetProviderId: 'poe', name: 'Poe', orderKey: 'a0' },
        { providerId: 'poe-copy', presetProviderId: 'poe', name: 'Copy', orderKey: 'a1' },
        { providerId: 'other', name: 'Other', orderKey: 'a2' }
      ])
      .run()
    db.insert(userModelTable)
      .values([
        modelRow('poe', 'perplexity-adv-deep-research', { endpointTypes: [ENDPOINT_TYPE.OPENAI_RESPONSES] }),
        ...[
          'gpt-5.2',
          'nano-banana-2',
          'claude-opus-4.8',
          'veo-3.1',
          'perplexity-search',
          'GROK-4.3',
          'grok-4-3',
          'grok-4.3-extra'
        ].map((id, index) => modelRow('poe', id, { orderKey: `a${index + 1}` })),
        modelRow('other', 'perplexity-adv-deep-research'),
        modelRow('poe-copy', 'claude-sonnet-5.5')
      ])
      .run()
    const models = db.select().from(userModelTable).all()
    const providers = db.select().from(userProviderTable).all()
    new PoeChatEndpointUpgradeSeeder().run(db)
    expect(db.select().from(userModelTable).all()).toEqual(models)
    expect(db.select().from(userProviderTable).all()).toEqual(providers)
  })

  it('preserves all models under a canonical provider with an explicit default', () => {
    const db = dbh.db
    db.insert(userProviderTable)
      .values({
        providerId: 'poe',
        presetProviderId: 'poe',
        name: 'Poe',
        orderKey: 'a0',
        defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES
      })
      .run()
    db.insert(userModelTable).values(modelRow('poe', 'perplexity-adv-deep-research')).run()
    const before = db.select().from(userModelTable).all()
    new PoeChatEndpointUpgradeSeeder().run(db)
    expect(db.select().from(userModelTable).all()).toEqual(before)
  })

  it('rolls back all corrections when a write fails before journaling', () => {
    const db = dbh.db
    db.insert(userProviderTable)
      .values({ providerId: 'poe', presetProviderId: 'poe', name: 'Poe', orderKey: 'a0' })
      .run()
    db.insert(userModelTable)
      .values([modelRow('poe', 'grok-4.3'), modelRow('poe', 'perplexity-adv-deep-research', { orderKey: 'a1' })])
      .run()
    const before = db.select().from(userModelTable).all()
    dbh.sqlite.exec(`CREATE TRIGGER fail_poe_repair BEFORE UPDATE ON user_model
      WHEN NEW.model_id = 'perplexity-adv-deep-research' BEGIN SELECT RAISE(ABORT, 'injected failure'); END`)
    try {
      expect(() => new PoeChatEndpointUpgradeSeeder().run(db)).toThrow()
      expect(db.select().from(userModelTable).all()).toEqual(before)
    } finally {
      dbh.sqlite.exec('DROP TRIGGER fail_poe_repair')
    }
    new PoeChatEndpointUpgradeSeeder().run(db)
    expect(db.select().from(userModelTable).where(eq(userModelTable.modelId, 'grok-4.3')).get()?.endpointTypes).toEqual(
      [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
    )
  })
})
