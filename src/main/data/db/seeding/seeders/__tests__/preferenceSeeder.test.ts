import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSelect = vi.fn()
const mockInsert = vi.fn()

vi.mock('@data/db/schemas/preference', () => ({
  preferenceTable: { scope: 'scope', key: 'key' }
}))

vi.mock('@shared/data/preference/preferenceSchemas', () => ({
  DefaultPreferences: {
    default: {
      'app.theme': 'dark',
      'app.language': 'en',
      'chat.font_size': 14
    }
  }
}))

const { PreferenceSeeder } = await import('../preferenceSeeder')

function createMockDb() {
  return {
    select: mockSelect,
    insert: mockInsert
  }
}

describe('PreferenceSeeder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should insert all default preferences into empty table', async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockResolvedValue([])
    })
    const valuesArg = vi.fn().mockResolvedValue(undefined)
    mockInsert.mockReturnValue({ values: valuesArg })

    const seed = new PreferenceSeeder()
    await seed.run(createMockDb() as any)

    expect(mockInsert).toHaveBeenCalledTimes(1)
    const inserted = valuesArg.mock.calls[0][0] as Array<{ scope: string; key: string; value: unknown }>
    expect(inserted).toHaveLength(3)
    expect(inserted).toEqual(
      expect.arrayContaining([
        { scope: 'default', key: 'app.theme', value: 'dark' },
        { scope: 'default', key: 'app.language', value: 'en' },
        { scope: 'default', key: 'chat.font_size', value: 14 }
      ])
    )
  })

  it('should only insert missing preferences when some exist', async () => {
    const existing = [{ scope: 'default', key: 'app.theme', value: 'dark' }]
    mockSelect.mockReturnValue({
      from: vi.fn().mockResolvedValue(existing)
    })
    const valuesArg = vi.fn().mockResolvedValue(undefined)
    mockInsert.mockReturnValue({ values: valuesArg })

    const seed = new PreferenceSeeder()
    await seed.run(createMockDb() as any)

    expect(mockInsert).toHaveBeenCalledTimes(1)
    const inserted = valuesArg.mock.calls[0][0] as Array<{ scope: string; key: string; value: unknown }>
    expect(inserted).toHaveLength(2)
    expect(inserted.find((p) => p.key === 'app.theme')).toBeUndefined()
    expect(inserted).toEqual(
      expect.arrayContaining([
        { scope: 'default', key: 'app.language', value: 'en' },
        { scope: 'default', key: 'chat.font_size', value: 14 }
      ])
    )
  })

  it('should not insert when all preferences exist', async () => {
    const allExisting = [
      { scope: 'default', key: 'app.theme', value: 'dark' },
      { scope: 'default', key: 'app.language', value: 'en' },
      { scope: 'default', key: 'chat.font_size', value: 14 }
    ]
    mockSelect.mockReturnValue({
      from: vi.fn().mockResolvedValue(allExisting)
    })

    const seed = new PreferenceSeeder()
    await seed.run(createMockDb() as any)

    expect(mockInsert).not.toHaveBeenCalled()
  })
})
