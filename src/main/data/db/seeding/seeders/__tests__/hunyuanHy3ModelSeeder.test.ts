import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { HunyuanHy3ModelSeeder } from '@data/db/seeding/seeders/hunyuanHy3ModelSeeder'
import { generateOrderKeyBetween } from '@data/services/utils/orderKey'
import {
  HUNYUAN_HY3_MODEL_GROUP,
  HUNYUAN_HY3_MODEL_ID,
  HUNYUAN_HY3_MODEL_NAME,
  HUNYUAN_HY3_UNIQUE_MODEL_ID,
  HUNYUAN_PROVIDER_ID
} from '@shared/data/presets/hunyuan'
import { ENDPOINT_TYPE, MODEL_CAPABILITY } from '@shared/data/types/model'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

// Fake registry — the seeder resolves the hy3 row through `mergePresetModel`,
// so the registry must surface the `hy3` provider-models override plus the
// Hunyuan provider's per-endpoint reasoning formats. Mirrors the real
// `provider-models.json` / `providers.json` entries so the test still validates
// the registry → DB-row mapping (not just a hand-typed row).
vi.mock('@cherrystudio/provider-registry/node', () => {
  const HY3_OVERRIDE = {
    providerId: 'hunyuan',
    modelId: 'hy3',
    apiModelId: 'hy3',
    name: 'Hy3',
    family: 'hunyuan',
    ownedBy: 'tencent',
    capabilities: { force: ['function-call', 'reasoning'] },
    endpointTypes: ['openai-chat-completions', 'anthropic-messages'],
    inputModalities: ['text'],
    outputModalities: ['text'],
    reasoning: { supportedEfforts: ['none', 'high'] }
  }

  const HUNYUAN_PROVIDER = {
    id: 'hunyuan',
    name: 'Tencent Hy',
    defaultChatEndpoint: 'openai-chat-completions',
    endpointConfigs: {
      'openai-chat-completions': {
        baseUrl: 'https://tokenhub.tencentmaas.com/v1',
        adapterFamily: 'openai-compatible',
        reasoningFormat: { type: 'openai-chat' }
      },
      'anthropic-messages': {
        baseUrl: 'https://tokenhub.tencentmaas.com',
        adapterFamily: 'anthropic',
        reasoningFormat: { type: 'anthropic' }
      }
    }
  }

  class RegistryLoader {
    findOverride(providerId: string, modelId: string) {
      return providerId === 'hunyuan' && modelId === 'hy3' ? HY3_OVERRIDE : null
    }
    findModel() {
      return null
    }
    loadProviders() {
      return [HUNYUAN_PROVIDER]
    }
  }

  return { RegistryLoader }
})

describe('HunyuanHy3ModelSeeder', () => {
  const dbh = setupTestDatabase()

  async function insertHunyuanProvider() {
    await dbh.db.insert(userProviderTable).values({
      providerId: HUNYUAN_PROVIDER_ID,
      presetProviderId: HUNYUAN_PROVIDER_ID,
      name: 'hunyuan',
      orderKey: generateOrderKeyBetween(null, null)
    })
  }

  async function readHy3Model() {
    const [model] = await dbh.db
      .select()
      .from(userModelTable)
      .where(eq(userModelTable.id, HUNYUAN_HY3_UNIQUE_MODEL_ID))
      .limit(1)
    return model
  }

  it('seeds the hy3 model with dual-protocol endpoints and reasoning efforts resolved from the registry', async () => {
    await insertHunyuanProvider()

    await new HunyuanHy3ModelSeeder().run(dbh.db)

    const model = await readHy3Model()
    expect(model).toMatchObject({
      id: HUNYUAN_HY3_UNIQUE_MODEL_ID,
      providerId: HUNYUAN_PROVIDER_ID,
      modelId: HUNYUAN_HY3_MODEL_ID,
      name: HUNYUAN_HY3_MODEL_NAME,
      group: HUNYUAN_HY3_MODEL_GROUP,
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    })
    expect(model?.capabilities).toEqual([MODEL_CAPABILITY.FUNCTION_CALL, MODEL_CAPABILITY.REASONING])
    expect(model?.endpointTypes).toEqual([ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, ENDPOINT_TYPE.ANTHROPIC_MESSAGES])
    expect(model?.reasoning).toEqual({ type: 'openai-chat', supportedEfforts: ['none', 'high'] })
  })

  it('skips seeding when the hunyuan provider row is absent (no FK crash)', async () => {
    await new HunyuanHy3ModelSeeder().run(dbh.db)

    expect(await readHy3Model()).toBeUndefined()
  })

  it('is idempotent — a second run does not duplicate the model', async () => {
    await insertHunyuanProvider()

    await new HunyuanHy3ModelSeeder().run(dbh.db)
    await new HunyuanHy3ModelSeeder().run(dbh.db)

    const models = await dbh.db.select().from(userModelTable).where(eq(userModelTable.id, HUNYUAN_HY3_UNIQUE_MODEL_ID))
    expect(models).toHaveLength(1)
  })
})
