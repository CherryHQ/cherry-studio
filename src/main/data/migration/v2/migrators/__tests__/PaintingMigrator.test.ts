import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }))
  }
}))

import { PaintingMigrator } from '../PaintingMigrator'

function createMigrationContext(
  paintingsState: Record<string, unknown>,
  insertedRows: unknown[]
): Record<string, unknown> {
  return {
    sources: {
      reduxState: {
        getCategory: vi.fn((name: string) => (name === 'paintings' ? paintingsState : undefined))
      }
    },
    db: {
      transaction: vi.fn(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) =>
        fn({
          insert: vi.fn(() => ({
            values: vi.fn(async (values: unknown[]) => {
              insertedRows.push(...values)
            })
          }))
        })
      ),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          get: vi.fn(async () => ({ count: insertedRows.length }))
        }))
      }))
    }
  }
}

describe('PaintingMigrator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('prepares records with scope-aware orderKey and DMXAPI mode normalization', async () => {
    const migrator = new PaintingMigrator()
    const insertedRows: unknown[] = []
    const ctx = createMigrationContext(
      {
        dmxapi_paintings: [
          { id: 'dmx-1', prompt: 'first', generationMode: 'generation' },
          { id: 'dmx-2', prompt: 'second', generationMode: 'edit' }
        ],
        openai_image_generate: [{ id: 'openai-1', providerId: 'custom-openai', prompt: 'third' }]
      },
      insertedRows
    )

    const prepareResult = await migrator.prepare(ctx as never)
    expect(prepareResult.success).toBe(true)

    const preparedRows = (migrator as unknown as { preparedPaintings: Array<Record<string, unknown>> })
      .preparedPaintings
    expect(preparedRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'dmx-1',
          providerId: 'dmxapi',
          mode: 'generate',
          orderKey: expect.any(String)
        }),
        expect.objectContaining({
          id: 'dmx-2',
          providerId: 'dmxapi',
          mode: 'edit',
          orderKey: expect.any(String)
        }),
        expect.objectContaining({
          id: 'openai-1',
          providerId: 'custom-openai',
          mode: 'generate',
          orderKey: expect.any(String)
        })
      ])
    )
  })

  it('executes inserts and validates migrated row counts', async () => {
    const migrator = new PaintingMigrator()
    const insertedRows: unknown[] = []
    const ctx = createMigrationContext(
      {
        siliconflow_paintings: [{ id: 'painting-1', prompt: 'hello' }],
        ppio_edit: [{ id: 'painting-2', prompt: 'world', taskId: 'task-2' }]
      },
      insertedRows
    )

    await migrator.prepare(ctx as never)
    await expect(migrator.execute(ctx as never)).resolves.toMatchObject({
      success: true,
      processedCount: 2
    })
    await expect(migrator.validate(ctx as never)).resolves.toMatchObject({
      success: true,
      stats: {
        sourceCount: 2,
        targetCount: 2,
        skippedCount: 0
      }
    })
  })
})
