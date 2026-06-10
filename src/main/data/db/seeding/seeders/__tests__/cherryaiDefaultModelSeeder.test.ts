import { preferenceTable } from '@data/db/schemas/preference'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { CherryAIDefaultModelSeeder } from '@data/db/seeding/seeders/cherryaiDefaultModelSeeder'
import { generateOrderKeyBetween } from '@data/services/utils/orderKey'
import {
  CHERRYAI_API_BASE_URL,
  CHERRYAI_DEFAULT_MODEL_GROUP,
  CHERRYAI_DEFAULT_MODEL_ID,
  CHERRYAI_DEFAULT_MODEL_NAME,
  CHERRYAI_DEFAULT_UNIQUE_MODEL_ID,
  CHERRYAI_PROVIDER_ID
} from '@shared/data/presets/cherryai'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { setupTestDatabase } from '@test-helpers/db'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

describe('CherryAIDefaultModelSeeder', () => {
  const dbh = setupTestDatabase()

  it('seeds CherryAI provider, Qwen model, and missing chat default model preference', async () => {
    await new CherryAIDefaultModelSeeder().run(dbh.db)

    const [provider] = await dbh.db
      .select()
      .from(userProviderTable)
      .where(eq(userProviderTable.providerId, CHERRYAI_PROVIDER_ID))
      .limit(1)
    const [model] = await dbh.db
      .select()
      .from(userModelTable)
      .where(eq(userModelTable.id, CHERRYAI_DEFAULT_UNIQUE_MODEL_ID))
      .limit(1)
    const [preference] = await dbh.db
      .select()
      .from(preferenceTable)
      .where(and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, 'chat.default_model_id')))
      .limit(1)

    expect(provider).toMatchObject({
      providerId: CHERRYAI_PROVIDER_ID,
      presetProviderId: CHERRYAI_PROVIDER_ID,
      name: 'CherryAI',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
    })
    expect(provider?.endpointConfigs?.[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]?.baseUrl).toBe(CHERRYAI_API_BASE_URL)
    expect(model).toMatchObject({
      id: CHERRYAI_DEFAULT_UNIQUE_MODEL_ID,
      providerId: CHERRYAI_PROVIDER_ID,
      modelId: CHERRYAI_DEFAULT_MODEL_ID,
      name: CHERRYAI_DEFAULT_MODEL_NAME,
      group: CHERRYAI_DEFAULT_MODEL_GROUP,
      isEnabled: true,
      isHidden: false
    })
    expect(preference?.value).toBe(CHERRYAI_DEFAULT_UNIQUE_MODEL_ID)
  })

  it('does not overwrite an existing non-empty chat default model preference', async () => {
    await dbh.db.insert(preferenceTable).values({
      scope: 'default',
      key: 'chat.default_model_id',
      value: 'openai::gpt-4o'
    })

    await new CherryAIDefaultModelSeeder().run(dbh.db)

    const [preference] = await dbh.db
      .select()
      .from(preferenceTable)
      .where(and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, 'chat.default_model_id')))
      .limit(1)
    expect(preference?.value).toBe('openai::gpt-4o')
  })

  it('backfills null chat default model preferences', async () => {
    await dbh.db.insert(preferenceTable).values({
      scope: 'default',
      key: 'chat.default_model_id',
      value: null
    })

    await new CherryAIDefaultModelSeeder().run(dbh.db)

    const [preference] = await dbh.db
      .select()
      .from(preferenceTable)
      .where(and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, 'chat.default_model_id')))
      .limit(1)
    expect(preference?.value).toBe(CHERRYAI_DEFAULT_UNIQUE_MODEL_ID)
  })

  it('backfills empty chat default model preferences', async () => {
    await dbh.db.insert(preferenceTable).values({
      scope: 'default',
      key: 'chat.default_model_id',
      value: ''
    })

    await new CherryAIDefaultModelSeeder().run(dbh.db)

    const [preference] = await dbh.db
      .select()
      .from(preferenceTable)
      .where(and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, 'chat.default_model_id')))
      .limit(1)
    expect(preference?.value).toBe(CHERRYAI_DEFAULT_UNIQUE_MODEL_ID)
  })

  it('preserves an existing CherryAI provider row', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: CHERRYAI_PROVIDER_ID,
      presetProviderId: CHERRYAI_PROVIDER_ID,
      name: 'Renamed CherryAI',
      orderKey: generateOrderKeyBetween(null, null)
    })

    await new CherryAIDefaultModelSeeder().run(dbh.db)

    const [provider] = await dbh.db
      .select()
      .from(userProviderTable)
      .where(eq(userProviderTable.providerId, CHERRYAI_PROVIDER_ID))
      .limit(1)
    const [model] = await dbh.db
      .select()
      .from(userModelTable)
      .where(eq(userModelTable.id, CHERRYAI_DEFAULT_UNIQUE_MODEL_ID))
      .limit(1)

    expect(provider?.name).toBe('Renamed CherryAI')
    expect(model?.id).toBe(CHERRYAI_DEFAULT_UNIQUE_MODEL_ID)
  })
})
