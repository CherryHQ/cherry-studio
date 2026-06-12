import { appStateTable } from '@data/db/schemas/appState'
import { assistantTable } from '@data/db/schemas/assistant'
import { messageTable } from '@data/db/schemas/message'
import { preferenceTable } from '@data/db/schemas/preference'
import { topicTable } from '@data/db/schemas/topic'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { CherryAiDefaultModelSeeder } from '@data/db/seeding/seeders/cherryaiDefaultModelSeeder'
import { DefaultAssistantSeeder } from '@data/db/seeding/seeders/defaultAssistantSeeder'
import { SEED_KEY_PREFIX } from '@data/db/seeding/SeedRunner'
import { generateOrderKeyBetween } from '@data/services/utils/orderKey'
import { CHERRYAI_DEFAULT_UNIQUE_MODEL_ID, CHERRYAI_PROVIDER_ID } from '@shared/data/presets/cherryai'
import {
  DEFAULT_ASSISTANT_EMOJI,
  DEFAULT_ASSISTANT_NAME,
  DEFAULT_ASSISTANT_PROMPT
} from '@shared/data/presets/default-assistant'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import { setupTestDatabase } from '@test-helpers/db'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

describe('DefaultAssistantSeeder', () => {
  const dbh = setupTestDatabase()
  const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

  async function runCherryAiModelDependencySeed() {
    const dependencySeeder = new CherryAiDefaultModelSeeder()
    await dependencySeeder.run(dbh.db)
    await dbh.db.insert(appStateTable).values({
      key: `${SEED_KEY_PREFIX}${dependencySeeder.name}`,
      value: { version: dependencySeeder.version }
    })
  }

  it('seeds the default assistant when only the CherryAI default model dependency seed has run', async () => {
    await runCherryAiModelDependencySeed()

    await new DefaultAssistantSeeder().run(dbh.db)

    const [assistant] = await dbh.db.select().from(assistantTable).limit(1)
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

    expect(assistant?.id).toMatch(UUID_V4_PATTERN)
    expect(assistant).toMatchObject({
      name: DEFAULT_ASSISTANT_NAME,
      emoji: DEFAULT_ASSISTANT_EMOJI,
      prompt: DEFAULT_ASSISTANT_PROMPT,
      modelId: CHERRYAI_DEFAULT_UNIQUE_MODEL_ID,
      settings: DEFAULT_ASSISTANT_SETTINGS
    })
    expect(provider).toMatchObject({
      providerId: CHERRYAI_PROVIDER_ID,
      isEnabled: true
    })
    expect(model?.id).toBe(CHERRYAI_DEFAULT_UNIQUE_MODEL_ID)
    expect(preference?.value).toBe(CHERRYAI_DEFAULT_UNIQUE_MODEL_ID)
  })

  it('does not seed the default assistant when any seed journal already exists', async () => {
    await dbh.db.insert(appStateTable).values({
      key: 'seed:preference',
      value: { version: 'already-applied' }
    })

    await new DefaultAssistantSeeder().run(dbh.db)

    const rows = await dbh.db.select().from(assistantTable)
    expect(rows).toHaveLength(0)
  })

  it('does not seed the default assistant when an active assistant already exists', async () => {
    await dbh.db.insert(assistantTable).values({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Existing Assistant',
      emoji: '🌟',
      settings: DEFAULT_ASSISTANT_SETTINGS,
      orderKey: generateOrderKeyBetween(null, null)
    })

    await new DefaultAssistantSeeder().run(dbh.db)

    const rows = await dbh.db.select().from(assistantTable)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('11111111-1111-4111-8111-111111111111')
  })

  it('does not seed the default assistant when an active topic already exists', async () => {
    await dbh.db.insert(topicTable).values({
      id: '22222222-2222-4222-8222-222222222222',
      orderKey: generateOrderKeyBetween(null, null)
    })

    await new DefaultAssistantSeeder().run(dbh.db)

    const rows = await dbh.db.select().from(assistantTable)
    expect(rows).toHaveLength(0)
  })

  it('does not seed the default assistant when an active message already exists', async () => {
    await dbh.db.insert(topicTable).values({
      id: '33333333-3333-4333-8333-333333333333',
      orderKey: generateOrderKeyBetween(null, null)
    })
    await dbh.db.insert(messageTable).values({
      id: '44444444-4444-4444-8444-444444444444',
      topicId: '33333333-3333-4333-8333-333333333333',
      role: 'user',
      data: { parts: [] },
      status: 'success'
    })

    await new DefaultAssistantSeeder().run(dbh.db)

    const rows = await dbh.db.select().from(assistantTable)
    expect(rows).toHaveLength(0)
  })
})
