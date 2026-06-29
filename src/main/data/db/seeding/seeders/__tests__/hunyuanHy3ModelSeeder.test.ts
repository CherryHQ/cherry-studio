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
import { describe, expect, it } from 'vitest'

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

  it('seeds the hy3 model with dual-protocol endpoints and reasoning efforts', async () => {
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
