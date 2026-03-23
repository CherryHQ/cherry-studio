import { BUILTIN_TRANSLATE_LANGUAGES } from '@shared/data/presets/translate-languages'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSelect = vi.fn()
const mockInsert = vi.fn()

vi.mock('@data/db/schemas/translateLanguage', () => ({
  translateLanguageTable: { langCode: 'lang_code' }
}))

const TranslateLanguageSeed = (await import('../translateLanguageSeeding')).default

function createMockDb() {
  return {
    select: mockSelect,
    insert: mockInsert
  }
}

describe('TranslateLanguageSeed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should insert all builtin languages into empty table', async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockResolvedValue([])
    })
    const valuesArg = vi.fn().mockResolvedValue(undefined)
    mockInsert.mockReturnValue({ values: valuesArg })

    const seed = new TranslateLanguageSeed()
    await seed.migrate(createMockDb() as any)

    expect(mockInsert).toHaveBeenCalledTimes(1)
    expect(valuesArg).toHaveBeenCalledWith(BUILTIN_TRANSLATE_LANGUAGES)
  })

  it('should only insert missing languages when some exist', async () => {
    const existingCodes = [{ langCode: 'en-us' }, { langCode: 'zh-cn' }]
    mockSelect.mockReturnValue({
      from: vi.fn().mockResolvedValue(existingCodes)
    })
    const valuesArg = vi.fn().mockResolvedValue(undefined)
    mockInsert.mockReturnValue({ values: valuesArg })

    const seed = new TranslateLanguageSeed()
    await seed.migrate(createMockDb() as any)

    expect(mockInsert).toHaveBeenCalledTimes(1)
    const inserted = valuesArg.mock.calls[0][0] as typeof BUILTIN_TRANSLATE_LANGUAGES
    expect(inserted).toHaveLength(BUILTIN_TRANSLATE_LANGUAGES.length - 2)
    expect(inserted.find((l) => l.langCode === 'en-us')).toBeUndefined()
    expect(inserted.find((l) => l.langCode === 'zh-cn')).toBeUndefined()
  })

  it('should not insert when all languages exist', async () => {
    const allCodes = BUILTIN_TRANSLATE_LANGUAGES.map((l) => ({ langCode: l.langCode }))
    mockSelect.mockReturnValue({
      from: vi.fn().mockResolvedValue(allCodes)
    })

    const seed = new TranslateLanguageSeed()
    await seed.migrate(createMockDb() as any)

    expect(mockInsert).not.toHaveBeenCalled()
  })
})
