import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { ClaudeCodeProviderSeeder } from '@data/db/seeding/seeders/claudeCodeProviderSeeder'
import { generateOrderKeyBetween } from '@data/services/utils/orderKey'
import {
  CLAUDE_CODE_API_BASE_URL,
  CLAUDE_CODE_DEFAULT_MODELS,
  CLAUDE_CODE_DEFAULT_UNIQUE_MODEL_ID,
  CLAUDE_CODE_PROVIDER_ID,
  CLAUDE_CODE_PROVIDER_NAME
} from '@shared/data/presets/claudeCode'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

describe('ClaudeCodeProviderSeeder', () => {
  const dbh = setupTestDatabase()

  it('seeds the agent-only Claude Code provider with no auth config and its default models', async () => {
    await new ClaudeCodeProviderSeeder().run(dbh.db)

    const [provider] = await dbh.db
      .select()
      .from(userProviderTable)
      .where(eq(userProviderTable.providerId, CLAUDE_CODE_PROVIDER_ID))
      .limit(1)
    const models = await dbh.db
      .select()
      .from(userModelTable)
      .where(eq(userModelTable.providerId, CLAUDE_CODE_PROVIDER_ID))

    expect(provider).toMatchObject({
      providerId: CLAUDE_CODE_PROVIDER_ID,
      presetProviderId: CLAUDE_CODE_PROVIDER_ID,
      name: CLAUDE_CODE_PROVIDER_NAME,
      defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
      isEnabled: true
    })
    // Login-based provider: no API key/auth so the SDK falls back to the Claude Code CLI subscription.
    expect(provider?.authConfig).toBeNull()
    expect(provider?.endpointConfigs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]?.baseUrl).toBe(CLAUDE_CODE_API_BASE_URL)
    expect(models).toHaveLength(CLAUDE_CODE_DEFAULT_MODELS.length)
    expect(models.some((m) => m.id === CLAUDE_CODE_DEFAULT_UNIQUE_MODEL_ID)).toBe(true)
  })

  it('is idempotent — a second run neither duplicates models nor overwrites a renamed provider', async () => {
    await new ClaudeCodeProviderSeeder().run(dbh.db)
    await dbh.db
      .update(userProviderTable)
      .set({ name: 'Renamed Claude Code' })
      .where(eq(userProviderTable.providerId, CLAUDE_CODE_PROVIDER_ID))

    await new ClaudeCodeProviderSeeder().run(dbh.db)

    const providers = await dbh.db
      .select()
      .from(userProviderTable)
      .where(eq(userProviderTable.providerId, CLAUDE_CODE_PROVIDER_ID))
    const models = await dbh.db
      .select()
      .from(userModelTable)
      .where(eq(userModelTable.providerId, CLAUDE_CODE_PROVIDER_ID))

    expect(providers).toHaveLength(1)
    expect(providers[0]?.name).toBe('Renamed Claude Code')
    expect(models).toHaveLength(CLAUDE_CODE_DEFAULT_MODELS.length)
  })

  it('preserves an existing Claude Code provider row', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: CLAUDE_CODE_PROVIDER_ID,
      presetProviderId: CLAUDE_CODE_PROVIDER_ID,
      name: 'User Claude Code',
      orderKey: generateOrderKeyBetween(null, null)
    })

    await new ClaudeCodeProviderSeeder().run(dbh.db)

    const [provider] = await dbh.db
      .select()
      .from(userProviderTable)
      .where(eq(userProviderTable.providerId, CLAUDE_CODE_PROVIDER_ID))
      .limit(1)
    expect(provider?.name).toBe('User Claude Code')
  })
})
