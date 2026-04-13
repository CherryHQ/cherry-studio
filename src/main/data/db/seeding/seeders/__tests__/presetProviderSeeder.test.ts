/**
 * Regression tests for PresetProviderSeeder.run — insert-only behavior.
 *
 * Regression: An earlier implementation called db.insert() unconditionally and
 * used onConflictDoUpdate, overwriting user customizations (renamed providers,
 * custom API keys, etc.) on every app start. The fix filters out already-present
 * provider IDs and only inserts genuinely new rows.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// Mocks — must be declared before dynamic imports
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

// Fake registry providers — two preset providers: 'openai' and 'anthropic'
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

// Import AFTER mocks
const { PresetProviderSeeder } = await import('../presetProviderSeeder')

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a minimal mock db.
 * @param existingProviderIds - provider IDs already present in the DB
 */
function createMockDb(existingProviderIds: string[]) {
  const insertedValues: unknown[] = []

  const existingRows = existingProviderIds.map((id) => ({ providerId: id }))

  const insertChain = {
    values: vi.fn((rows: unknown) => {
      insertedValues.push(rows)
      return Promise.resolve()
    })
  }

  const mockInsert = vi.fn(() => insertChain)

  const selectChain = {
    from: vi.fn(() => Promise.resolve(existingRows))
  }

  const mockSelect = vi.fn(() => selectChain)

  return {
    db: { select: mockSelect, insert: mockInsert },
    insertedValues,
    insertChain,
    mockInsert
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('PresetProviderSeeder.run — insert-only behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should insert all preset providers (plus cherryai) when DB is empty', async () => {
    const { db, insertedValues, mockInsert } = createMockDb([])

    const seed = new PresetProviderSeeder()
    await seed.run(db as any)

    // insert must be called exactly once with all new rows
    expect(mockInsert).toHaveBeenCalledTimes(1)

    const rows = insertedValues[0] as Array<{ providerId: string }>
    const insertedIds = rows.map((r) => r.providerId)

    expect(insertedIds).toContain('openai')
    expect(insertedIds).toContain('anthropic')
    // cherryai is always seeded if absent
    expect(insertedIds).toContain('cherryai')
  })

  it('should NOT re-insert openai when it already exists in DB', async () => {
    // 'openai' is already present — only 'anthropic' and 'cherryai' are new
    const { db, insertedValues, mockInsert } = createMockDb(['openai'])

    const seed = new PresetProviderSeeder()
    await seed.run(db as any)

    expect(mockInsert).toHaveBeenCalledTimes(1)

    const rows = insertedValues[0] as Array<{ providerId: string }>
    const insertedIds = rows.map((r) => r.providerId)

    // openai must NOT appear in the insert payload
    expect(insertedIds).not.toContain('openai')
    // The remaining new providers should be present
    expect(insertedIds).toContain('anthropic')
    expect(insertedIds).toContain('cherryai')
  })

  it('should not call insert at all when all providers (including cherryai) already exist', async () => {
    // Every provider the seed would add is already present
    const { db, mockInsert } = createMockDb(['openai', 'anthropic', 'cherryai'])

    const seed = new PresetProviderSeeder()
    await seed.run(db as any)

    // Nothing new to insert — insert must never be called
    expect(mockInsert).not.toHaveBeenCalled()
  })
})
