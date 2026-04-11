import type { ISeeder } from '@data/db/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSelect = vi.fn()
const mockInsert = vi.fn()

vi.mock('@data/db/schemas/appState', () => ({
  appStateTable: { key: 'key', value: 'value', updatedAt: 'updated_at' }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('drizzle-orm', () => ({
  inArray: vi.fn((_col: unknown, vals: unknown[]) => ({ _op: 'inArray', vals }))
}))

const { SeedRunner } = await import('../SeedRunner')

function createMockDb() {
  return {
    select: mockSelect,
    insert: mockInsert
  }
}

function createMockSeeder(overrides: Partial<ISeeder> = {}): ISeeder {
  return {
    name: 'test-seed',
    version: '1.0',
    description: 'Test seeder',
    run: vi.fn().mockResolvedValue(undefined),
    ...overrides
  }
}

describe('SeedRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should run seed and write journal on first run (no journal entry)', async () => {
    const mockFrom = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([])
    })
    mockSelect.mockReturnValue({ from: mockFrom })

    const onConflict = vi.fn().mockResolvedValue(undefined)
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate: onConflict })
    mockInsert.mockReturnValue({ values })

    const seeder = createMockSeeder()
    const db = createMockDb()
    const runner = new SeedRunner(db as any)
    await runner.runAll([seeder])

    expect(seeder.run).toHaveBeenCalledTimes(1)
    expect(seeder.run).toHaveBeenCalledWith(db)
    expect(mockInsert).toHaveBeenCalledTimes(1)
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'seed:test-seed',
        value: expect.objectContaining({ version: '1.0' })
      })
    )
  })

  it('should skip seed when version matches', async () => {
    const mockFrom = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([{ key: 'seed:test-seed', value: { version: '1.0' } }])
    })
    mockSelect.mockReturnValue({ from: mockFrom })

    const seeder = createMockSeeder({ version: '1.0' })
    const runner = new SeedRunner(createMockDb() as any)
    await runner.runAll([seeder])

    expect(seeder.run).not.toHaveBeenCalled()
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('should re-run seed and update journal when version changed', async () => {
    const mockFrom = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([{ key: 'seed:test-seed', value: { version: '0.9' } }])
    })
    mockSelect.mockReturnValue({ from: mockFrom })

    const onConflict = vi.fn().mockResolvedValue(undefined)
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate: onConflict })
    mockInsert.mockReturnValue({ values })

    const seeder = createMockSeeder({ version: '1.0' })
    const runner = new SeedRunner(createMockDb() as any)
    await runner.runAll([seeder])

    expect(seeder.run).toHaveBeenCalledTimes(1)
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'seed:test-seed',
        value: expect.objectContaining({ version: '1.0' })
      })
    )
    expect(onConflict).toHaveBeenCalledWith(
      expect.objectContaining({
        target: 'key',
        set: expect.objectContaining({
          value: expect.objectContaining({ version: '1.0' })
        })
      })
    )
  })

  it('should handle empty seeders array without errors', async () => {
    const runner = new SeedRunner(createMockDb() as any)
    await runner.runAll([])

    expect(mockSelect).not.toHaveBeenCalled()
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('should not write journal when seed run() throws', async () => {
    const mockFrom = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([])
    })
    mockSelect.mockReturnValue({ from: mockFrom })

    const seeder = createMockSeeder({
      run: vi.fn().mockRejectedValue(new Error('seed failed'))
    })
    const runner = new SeedRunner(createMockDb() as any)

    await expect(runner.runAll([seeder])).rejects.toThrow('seed failed')
    expect(seeder.run).toHaveBeenCalledTimes(1)
    expect(mockInsert).not.toHaveBeenCalled()
  })
})
