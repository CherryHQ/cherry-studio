import { CHAT_DEFAULT_MODEL_PREFERENCE_KEY, CHAT_DEFAULT_MODEL_PREFERENCE_SCOPE } from '@data/cherryaiDefaultModel'
import { preferenceTable } from '@data/db/schemas/preference'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { CherryAIDefaultModelSeeder } from '@data/db/seeding/seeders/cherryaiDefaultModelSeeder'
import type { DbType } from '@data/db/types'
import { generateOrderKeyBetween } from '@data/services/utils/orderKey'
import {
  CHERRYAI_DEFAULT_MODEL_ID,
  CHERRYAI_DEFAULT_MODEL_NAME,
  CHERRYAI_DEFAULT_UNIQUE_MODEL_ID,
  CHERRYAI_PROVIDER_ID,
  CHERRYAI_PROVIDER_NAME
} from '@shared/data/presets/cherryai'
import { setupTestDatabase } from '@test-helpers/db'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

async function getDefaultModelPreference(db: DbType) {
  const [row] = await db
    .select({ value: preferenceTable.value })
    .from(preferenceTable)
    .where(
      and(
        eq(preferenceTable.scope, CHAT_DEFAULT_MODEL_PREFERENCE_SCOPE),
        eq(preferenceTable.key, CHAT_DEFAULT_MODEL_PREFERENCE_KEY)
      )
    )
    .limit(1)
  return row?.value
}

describe('CherryAIDefaultModelSeeder', () => {
  const dbh = setupTestDatabase()

  it('seeds CherryAI provider, qwen model, and missing default model preference', async () => {
    const seed = new CherryAIDefaultModelSeeder()

    await seed.run(dbh.db)

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
      name: CHERRYAI_PROVIDER_NAME
    })
    expect(model).toMatchObject({
      id: CHERRYAI_DEFAULT_UNIQUE_MODEL_ID,
      providerId: CHERRYAI_PROVIDER_ID,
      modelId: CHERRYAI_DEFAULT_MODEL_ID,
      name: CHERRYAI_DEFAULT_MODEL_NAME
    })
    expect(await getDefaultModelPreference(dbh.db)).toBe(CHERRYAI_DEFAULT_UNIQUE_MODEL_ID)
  })

  it('does not overwrite an existing non-empty default model preference', async () => {
    await dbh.db.insert(preferenceTable).values({
      scope: CHAT_DEFAULT_MODEL_PREFERENCE_SCOPE,
      key: CHAT_DEFAULT_MODEL_PREFERENCE_KEY,
      value: 'openai::gpt-4o'
    })

    const seed = new CherryAIDefaultModelSeeder()
    await seed.run(dbh.db)

    expect(await getDefaultModelPreference(dbh.db)).toBe('openai::gpt-4o')
  })

  it('backfills qwen and empty preference without overwriting an existing CherryAI provider row', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: CHERRYAI_PROVIDER_ID,
      presetProviderId: CHERRYAI_PROVIDER_ID,
      name: 'User Renamed CherryAI',
      orderKey: generateOrderKeyBetween(null, null)
    })
    await dbh.db.insert(preferenceTable).values({
      scope: CHAT_DEFAULT_MODEL_PREFERENCE_SCOPE,
      key: CHAT_DEFAULT_MODEL_PREFERENCE_KEY,
      value: null
    })

    const seed = new CherryAIDefaultModelSeeder()
    await seed.run(dbh.db)

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

    expect(provider.name).toBe('User Renamed CherryAI')
    expect(model.id).toBe(CHERRYAI_DEFAULT_UNIQUE_MODEL_ID)
    expect(await getDefaultModelPreference(dbh.db)).toBe(CHERRYAI_DEFAULT_UNIQUE_MODEL_ID)
  })
})
