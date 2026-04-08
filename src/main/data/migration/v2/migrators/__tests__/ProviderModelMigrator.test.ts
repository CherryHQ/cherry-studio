import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MigrationContext } from '../../core/MigrationContext'
import { ProviderModelMigrator } from '../ProviderModelMigrator'

vi.mock('@main/core/application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

function createMockContext(reduxState: Record<string, unknown> = {}): MigrationContext {
  const insertValues: unknown[][] = []

  const mockTx = {
    insert: vi.fn(() => ({
      values: vi.fn((vals: unknown) => {
        insertValues.push(Array.isArray(vals) ? vals : [vals])
        return Promise.resolve()
      })
    }))
  }

  return {
    sources: {
      reduxState: {
        getCategory: vi.fn((cat: string) => reduxState[cat])
      }
    },
    db: {
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockTx)),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          get: vi.fn(() => Promise.resolve({ count: 0 }))
        }))
      }))
    },
    _insertValues: insertValues
  } as unknown as MigrationContext & { _insertValues: unknown[][] }
}

function makeProvider(id: string, models: Array<{ id: string }> = []) {
  return {
    id,
    name: `Provider ${id}`,
    type: 'openai',
    enabled: true,
    models
  }
}

describe('ProviderModelMigrator', () => {
  let migrator: ProviderModelMigrator

  beforeEach(() => {
    migrator = new ProviderModelMigrator()
  })

  describe('prepare', () => {
    it('returns success with provider count', async () => {
      const ctx = createMockContext({
        llm: {
          providers: [makeProvider('openai'), makeProvider('anthropic')]
        }
      })

      const result = await migrator.prepare(ctx)

      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(2)
    })

    it('handles missing providers gracefully', async () => {
      const ctx = createMockContext({ llm: {} })

      const result = await migrator.prepare(ctx)

      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(0)
    })

    it('deduplicates providers by ID', async () => {
      const ctx = createMockContext({
        llm: {
          providers: [makeProvider('openai'), makeProvider('openai'), makeProvider('anthropic')]
        }
      })

      const result = await migrator.prepare(ctx)

      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(2) // deduplicated
      expect(result.warnings).toBeDefined()
      expect(result.warnings?.some((w) => w.includes('duplicate'))).toBe(true)
    })
  })

  describe('execute', () => {
    it('returns success with zero count when no providers', async () => {
      const ctx = createMockContext({ llm: {} })
      await migrator.prepare(ctx)

      const result = await migrator.execute(ctx)

      expect(result.success).toBe(true)
      expect(result.processedCount).toBe(0)
    })

    it('processes providers and models', async () => {
      const ctx = createMockContext({
        llm: {
          providers: [makeProvider('openai', [{ id: 'gpt-4o' }, { id: 'gpt-4' }])]
        }
      })
      await migrator.prepare(ctx)

      const result = await migrator.execute(ctx)

      expect(result.success).toBe(true)
      expect(result.processedCount).toBe(1)
    })

    it('deduplicates models within a provider', async () => {
      const ctx = createMockContext({
        llm: {
          providers: [makeProvider('openai', [{ id: 'gpt-4o' }, { id: 'gpt-4o' }])]
        }
      })
      await migrator.prepare(ctx)

      const result = await migrator.execute(ctx)

      expect(result.success).toBe(true)
    })
  })

  describe('reset', () => {
    it('clears internal state', async () => {
      const ctx = createMockContext({
        llm: {
          providers: [makeProvider('openai')]
        }
      })
      await migrator.prepare(ctx)

      migrator.reset()

      const result = await migrator.execute(ctx)
      expect(result.processedCount).toBe(0)
    })
  })
})
