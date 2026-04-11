/**
 * Regression tests for ProviderService.delete — preset provider protection boundary.
 *
 * Regression: The guard `provider.presetProviderId === providerId` was previously
 * absent, allowing canonical preset providers ('openai', 'anthropic', etc.) to be
 * deleted directly. User-created copies that inherit from a preset must still be
 * deletable.
 */

import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

function createSelectMockReturning(rows: unknown[]) {
  const chain: Record<string, unknown> = {}
  const terminal = { then: (resolve: (v: unknown) => void) => resolve(rows) }

  chain.select = vi.fn(() => chain)
  chain.from = vi.fn(() => chain)
  chain.where = vi.fn(() => chain)
  chain.limit = vi.fn(() => terminal)

  return chain
}

function createDeleteMock() {
  const chain: Record<string, unknown> = {}
  chain.delete = vi.fn(() => chain)
  chain.where = vi.fn(() => Promise.resolve())
  return chain
}

function createMockDbForProvider(providerRow: unknown) {
  const selectChain = createSelectMockReturning([providerRow])
  const deleteChain = createDeleteMock()

  return {
    select: selectChain.select,
    from: selectChain.from,
    where: selectChain.where,
    limit: selectChain.limit,
    delete: deleteChain.delete
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('@main/core/application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

// ProviderService is a singleton — import after mocks are registered
const { providerService } = await import('../ProviderService')

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal valid UserProvider DB row shape */
function makeProviderRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    providerId: 'openai',
    presetProviderId: null,
    name: 'OpenAI',
    endpointConfigs: null,
    defaultChatEndpoint: null,
    apiKeys: [],
    authConfig: null,
    apiFeatures: null,
    providerSettings: null,
    isEnabled: true,
    sortOrder: 0,
    createdAt: null,
    updatedAt: null,
    ...overrides
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('ProviderService.delete — preset protection boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockMainDbServiceUtils.resetMocks()
  })

  it('should throw when deleting a canonical preset provider (providerId === presetProviderId)', async () => {
    // 'openai' row where both fields are identical — this IS the canonical preset
    const row = makeProviderRow({ providerId: 'openai', presetProviderId: 'openai' })
    MockMainDbServiceUtils.setDb(createMockDbForProvider(row))

    await expect(providerService.delete('openai')).rejects.toThrow(/Cannot delete preset provider/)
  })

  it('should NOT throw when deleting a user-created provider that inherits from a preset', async () => {
    // 'openai-work' row: user copy of the openai preset — presetProviderId differs from providerId
    const row = makeProviderRow({
      providerId: 'openai-work',
      presetProviderId: 'openai',
      name: 'OpenAI Work'
    })
    const mockDb = createMockDbForProvider(row)
    MockMainDbServiceUtils.setDb(mockDb)

    // Should resolve without throwing
    await expect(providerService.delete('openai-work')).resolves.toBeUndefined()
  })

  it('should NOT throw when deleting a fully custom provider with no presetProviderId', async () => {
    // A provider the user created from scratch — no preset linkage
    const row = makeProviderRow({
      providerId: 'my-local-llm',
      presetProviderId: null,
      name: 'My Local LLM'
    })
    MockMainDbServiceUtils.setDb(createMockDbForProvider(row))

    await expect(providerService.delete('my-local-llm')).resolves.toBeUndefined()
  })
})
