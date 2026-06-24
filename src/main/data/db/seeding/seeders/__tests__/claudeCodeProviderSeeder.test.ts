import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { ClaudeCodeProviderSeeder } from '@data/db/seeding/seeders/claudeCodeProviderSeeder'
import { generateOrderKeyBetween } from '@data/services/utils/orderKey'
import { CLAUDE_CODE_PROVIDER_ID } from '@shared/data/presets/claudeCode'
import type { Model } from '@shared/data/types/model'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// claude-code resolves its catalog through the registry service (provider-models.json
// → models.json). Mock it so the seeder is tested in isolation from the shipped data.
const { listProviderRegistryModels } = vi.hoisted(() => ({ listProviderRegistryModels: vi.fn() }))
vi.mock('@data/services/ProviderRegistryService', () => ({
  providerRegistryService: { listProviderRegistryModels }
}))

const REGISTRY_MODELS = [
  // Concrete model inheriting rich metadata from models.json.
  {
    id: 'claude-code::claude-opus-4-8',
    apiModelId: 'claude-opus-4-8',
    presetModelId: 'claude-opus-4-8',
    name: 'Claude Opus 4.8',
    family: 'claude-opus',
    capabilities: ['function-call', 'reasoning'],
    contextWindow: 1_000_000,
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false
  },
  // family 'claude' (Fable) → group falls back to 'Claude'.
  {
    id: 'claude-code::claude-fable-5',
    apiModelId: 'claude-fable-5',
    presetModelId: 'claude-fable-5',
    name: 'Claude Fable 5',
    family: 'claude',
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false
  }
] as unknown as Model[]

/** Mirror PresetProviderSeeder: insert the registry provider row, disabled. */
async function seedDisabledProvider(db: ReturnType<typeof setupTestDatabase>['db']) {
  await db.insert(userProviderTable).values({
    providerId: CLAUDE_CODE_PROVIDER_ID,
    presetProviderId: CLAUDE_CODE_PROVIDER_ID,
    name: 'Claude Code',
    isEnabled: false,
    orderKey: generateOrderKeyBetween(null, null)
  })
}

describe('ClaudeCodeProviderSeeder', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    listProviderRegistryModels.mockReset()
    listProviderRegistryModels.mockResolvedValue(REGISTRY_MODELS)
  })

  it('enables the disabled registry provider and materializes its registry models', async () => {
    await seedDisabledProvider(dbh.db)

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

    expect(provider?.isEnabled).toBe(true)
    expect(models).toHaveLength(REGISTRY_MODELS.length)

    const byId = new Map(models.map((m) => [m.id, m]))
    // Bare model id (not the unique id) lands in modelId; group derives from family.
    expect(byId.get('claude-code::claude-opus-4-8')).toMatchObject({
      modelId: 'claude-opus-4-8',
      group: 'Claude Opus',
      contextWindow: 1_000_000
    })
    expect(byId.get('claude-code::claude-fable-5')?.group).toBe('Claude')
  })

  it('is idempotent — a second run neither duplicates models nor re-disables the provider', async () => {
    await seedDisabledProvider(dbh.db)
    await new ClaudeCodeProviderSeeder().run(dbh.db)
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
    expect(providers[0]?.isEnabled).toBe(true)
    expect(models).toHaveLength(REGISTRY_MODELS.length)
  })

  it('preserves a user-disabled provider when a later registry re-seed adds missing models', async () => {
    await seedDisabledProvider(dbh.db)
    await new ClaudeCodeProviderSeeder().run(dbh.db)
    await dbh.db
      .update(userProviderTable)
      .set({ isEnabled: false })
      .where(eq(userProviderTable.providerId, CLAUDE_CODE_PROVIDER_ID))

    listProviderRegistryModels.mockResolvedValue([
      ...REGISTRY_MODELS,
      {
        id: 'claude-code::claude-sonnet-5',
        apiModelId: 'claude-sonnet-5',
        presetModelId: 'claude-sonnet-5',
        name: 'Claude Sonnet 5',
        family: 'claude-sonnet',
        capabilities: [],
        supportsStreaming: true,
        isEnabled: true,
        isHidden: false
      } as unknown as Model
    ])

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

    expect(provider?.isEnabled).toBe(false)
    expect(models).toHaveLength(REGISTRY_MODELS.length + 1)
  })
})
