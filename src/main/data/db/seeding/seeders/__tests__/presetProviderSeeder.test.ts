/**
 * Regression tests for PresetProviderSeeder.run — insert-only behavior.
 *
 * Regression: An earlier implementation called db.insert() unconditionally and
 * used onConflictDoUpdate, overwriting user customizations (renamed providers,
 * custom API keys, etc.) on every app start. The fix filters out already-present
 * provider IDs and only inserts genuinely new rows.
 */

import { userProviderTable } from '@data/db/schemas/userProvider'
import { PresetProviderSeeder } from '@data/db/seeding/seeders/presetProviderSeeder'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it, vi } from 'vitest'

// Fake registry providers — two preset providers: 'openai' and 'anthropic'.
// The seeder always also adds 'cherryai' as a built-in.
vi.mock('@cherrystudio/provider-registry/node', () => {
  class RegistryLoader {
    loadProviders() {
      return [
        { id: 'openai', name: 'OpenAI', endpointConfigs: {}, defaultChatEndpoint: null },
        { id: 'anthropic', name: 'Anthropic', endpointConfigs: {}, defaultChatEndpoint: null }
      ]
    }
    getProvidersVersion() {
      return 'test-version'
    }
    loadModels() {
      return []
    }
    loadProviderModels() {
      return []
    }
  }
  return { RegistryLoader }
})

vi.mock('@cherrystudio/provider-registry', async () => {
  const actual: Record<string, unknown> = await vi.importActual('@cherrystudio/provider-registry')
  return {
    ...actual,
    buildRuntimeEndpointConfigs: vi.fn(() => null)
  }
})

describe('PresetProviderSeeder.run — insert-only behavior', () => {
  const dbh = setupTestDatabase()

  it('should insert all preset providers (plus cherryai) when DB is empty', async () => {
    const seed = new PresetProviderSeeder()
    await seed.run(dbh.db)

    const rows = await dbh.db.select().from(userProviderTable)
    const ids = rows.map((r) => r.providerId)
    expect(ids).toContain('openai')
    expect(ids).toContain('anthropic')
    expect(ids).toContain('cherryai')
  })

  it('should NOT re-insert openai when it already exists in DB', async () => {
    await dbh.db.insert(userProviderTable).values({ providerId: 'openai', name: 'User-renamed OpenAI' })

    const seed = new PresetProviderSeeder()
    await seed.run(dbh.db)

    const rows = await dbh.db.select().from(userProviderTable)
    const openai = rows.find((r) => r.providerId === 'openai')
    // User customization must be preserved
    expect(openai?.name).toBe('User-renamed OpenAI')

    const ids = rows.map((r) => r.providerId)
    expect(ids).toContain('anthropic')
    expect(ids).toContain('cherryai')
  })

  it('should not insert anything when all providers (including cherryai) already exist', async () => {
    await dbh.db.insert(userProviderTable).values([
      { providerId: 'openai', name: 'OpenAI' },
      { providerId: 'anthropic', name: 'Anthropic' },
      { providerId: 'cherryai', name: 'CherryAI' }
    ])
    const before = await dbh.db.select().from(userProviderTable)

    const seed = new PresetProviderSeeder()
    await seed.run(dbh.db)

    const after = await dbh.db.select().from(userProviderTable)
    expect(after).toHaveLength(before.length)
  })
})
