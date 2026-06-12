import { preferenceTable } from '@data/db/schemas/preference'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import {
  CherryAiDefaultModelSeeder,
  DEFAULT_MODEL_PREFERENCE_KEYS
} from '@data/db/seeding/seeders/cherryaiDefaultModelSeeder'
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
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

describe('CherryAiDefaultModelSeeder', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    mockMainLoggerService.warn.mockClear()
  })

  async function readPreferenceValue(key: string) {
    const [preference] = await dbh.db
      .select()
      .from(preferenceTable)
      .where(and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, key)))
      .limit(1)
    return preference?.value
  }

  async function expectSeededDefaultModelPreferences() {
    for (const key of DEFAULT_MODEL_PREFERENCE_KEYS) {
      expect(await readPreferenceValue(key)).toBe(CHERRYAI_DEFAULT_UNIQUE_MODEL_ID)
    }
  }

  it('seeds CherryAI provider, Qwen model, and missing default model preferences', async () => {
    await new CherryAiDefaultModelSeeder().run(dbh.db)

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

    expect(provider).toMatchObject({
      providerId: CHERRYAI_PROVIDER_ID,
      presetProviderId: CHERRYAI_PROVIDER_ID,
      name: 'CherryAI',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      isEnabled: true
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
    await expectSeededDefaultModelPreferences()
    expect(mockMainLoggerService.warn).toHaveBeenCalledWith('Self-healed missing CherryAI default provider', {
      providerId: CHERRYAI_PROVIDER_ID
    })
    expect(mockMainLoggerService.warn).toHaveBeenCalledWith('Self-healed missing CherryAI default model', {
      modelId: CHERRYAI_DEFAULT_UNIQUE_MODEL_ID
    })
    expect(mockMainLoggerService.warn).toHaveBeenCalledWith('Self-healed missing default model preference', {
      key: 'chat.default_model_id',
      value: CHERRYAI_DEFAULT_UNIQUE_MODEL_ID
    })
  })

  it('does not overwrite existing non-empty default model preferences', async () => {
    await dbh.db.insert(preferenceTable).values([
      {
        scope: 'default',
        key: 'chat.default_model_id',
        value: 'openai::gpt-4o'
      },
      {
        scope: 'default',
        key: 'topic.naming.model_id',
        value: 'openai::gpt-4o-mini'
      },
      {
        scope: 'default',
        key: 'feature.quick_assistant.model_id',
        value: 'anthropic::claude-3-haiku'
      },
      {
        scope: 'default',
        key: 'feature.translate.model_id',
        value: 'google::gemini-2.5-flash'
      }
    ])

    await new CherryAiDefaultModelSeeder().run(dbh.db)

    expect(await readPreferenceValue('chat.default_model_id')).toBe('openai::gpt-4o')
    expect(await readPreferenceValue('topic.naming.model_id')).toBe('openai::gpt-4o-mini')
    expect(await readPreferenceValue('feature.quick_assistant.model_id')).toBe('anthropic::claude-3-haiku')
    expect(await readPreferenceValue('feature.translate.model_id')).toBe('google::gemini-2.5-flash')
  })

  it('preserves existing null default model preferences', async () => {
    await dbh.db.insert(preferenceTable).values(
      DEFAULT_MODEL_PREFERENCE_KEYS.map((key) => ({
        scope: 'default',
        key,
        value: null
      }))
    )

    await new CherryAiDefaultModelSeeder().run(dbh.db)

    for (const key of DEFAULT_MODEL_PREFERENCE_KEYS) {
      expect(await readPreferenceValue(key)).toBeNull()
    }
  })

  it('preserves existing empty default model preferences', async () => {
    await dbh.db.insert(preferenceTable).values(
      DEFAULT_MODEL_PREFERENCE_KEYS.map((key) => ({
        scope: 'default',
        key,
        value: ''
      }))
    )

    await new CherryAiDefaultModelSeeder().run(dbh.db)

    for (const key of DEFAULT_MODEL_PREFERENCE_KEYS) {
      expect(await readPreferenceValue(key)).toBe('')
    }
  })

  it('preserves an existing CherryAI provider row', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: CHERRYAI_PROVIDER_ID,
      presetProviderId: CHERRYAI_PROVIDER_ID,
      name: 'Renamed CherryAI',
      orderKey: generateOrderKeyBetween(null, null)
    })

    await new CherryAiDefaultModelSeeder().run(dbh.db)

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
