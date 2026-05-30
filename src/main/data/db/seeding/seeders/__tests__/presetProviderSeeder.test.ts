/**
 * Regression tests for PresetProviderSeeder.run — insert-only behavior.
 *
 * Regression: An earlier implementation called db.insert() unconditionally and
 * used onConflictDoUpdate, overwriting user customizations (renamed providers,
 * custom API keys, etc.) on every app start. The fix filters out already-present
 * provider IDs and only inserts genuinely new rows.
 */

import { ENDPOINT_TYPE } from '@cherrystudio/provider-registry'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { PresetProviderSeeder } from '@data/db/seeding/seeders/presetProviderSeeder'
import { generateOrderKeyBetween, generateOrderKeySequence } from '@data/services/utils/orderKey'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it, vi } from 'vitest'

// Fake registry providers — two preset providers: 'openai' and 'anthropic'.
// The seeder always also adds 'cherryai' as a built-in.
vi.mock('@cherrystudio/provider-registry/node', () => {
  class RegistryLoader {
    loadProviders() {
      return [
        { id: 'openai', name: 'OpenAI', endpointConfigs: {}, defaultChatEndpoint: null },
        { id: 'anthropic', name: 'Anthropic', endpointConfigs: {}, defaultChatEndpoint: null },
        { id: 'azure-openai', name: 'Azure OpenAI', endpointConfigs: {}, defaultChatEndpoint: null },
        { id: 'vertexai', name: 'Vertex AI', endpointConfigs: {}, defaultChatEndpoint: null },
        { id: 'aws-bedrock', name: 'AWS Bedrock', endpointConfigs: {}, defaultChatEndpoint: null }
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
    expect(ids).toContain('azure-openai')
    expect(ids).toContain('vertexai')
    expect(ids).toContain('aws-bedrock')
    expect(ids).toContain('cherryai')
  })

  it('should seed special provider defaults without relying on providers.json endpoint metadata', async () => {
    const seed = new PresetProviderSeeder()
    await seed.run(dbh.db)

    const rows = await dbh.db.select().from(userProviderTable)
    const azure = rows.find((r) => r.providerId === 'azure-openai')
    const vertex = rows.find((r) => r.providerId === 'vertexai')
    const bedrock = rows.find((r) => r.providerId === 'aws-bedrock')

    expect(azure?.defaultChatEndpoint).toBe(ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)
    expect(azure?.authConfig).toEqual({ type: 'iam-azure', apiVersion: '' })
    expect(vertex?.defaultChatEndpoint).toBe(ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT)
    expect(vertex?.authConfig).toEqual({ type: 'iam-gcp', project: '', location: '' })
    expect(bedrock?.defaultChatEndpoint).toBeNull()
    expect(bedrock?.authConfig).toEqual({ type: 'iam-aws', region: '' })
  })

  it('should NOT re-insert openai when it already exists in DB', async () => {
    await dbh.db
      .insert(userProviderTable)
      .values({ providerId: 'openai', name: 'User-renamed OpenAI', orderKey: generateOrderKeyBetween(null, null) })

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
    const [openaiKey, anthropicKey, azureKey, vertexKey, bedrockKey, cherryaiKey] = generateOrderKeySequence(6)
    await dbh.db.insert(userProviderTable).values([
      { providerId: 'openai', name: 'OpenAI', orderKey: openaiKey },
      { providerId: 'anthropic', name: 'Anthropic', orderKey: anthropicKey },
      { providerId: 'azure-openai', name: 'Azure OpenAI', orderKey: azureKey },
      { providerId: 'vertexai', name: 'Vertex AI', orderKey: vertexKey },
      { providerId: 'aws-bedrock', name: 'AWS Bedrock', orderKey: bedrockKey },
      { providerId: 'cherryai', name: 'CherryAI', orderKey: cherryaiKey }
    ])
    const before = await dbh.db.select().from(userProviderTable)

    const seed = new PresetProviderSeeder()
    await seed.run(dbh.db)

    const after = await dbh.db.select().from(userProviderTable)
    expect(after).toHaveLength(before.length)
  })
})
