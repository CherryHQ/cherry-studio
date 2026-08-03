import { parsePersistedLangCode } from '@shared/data/preference/preferenceTypes'
import type { TranslateLanguage } from '@shared/data/types/translate'
import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'

type LanguageFixture = Pick<TranslateLanguage, 'emoji' | 'value'> & { langCode: string }

export function setLanguagesQuery(data: LanguageFixture[] | undefined, { error }: { error?: Error } = {}) {
  const languages = data?.map((language) => ({
    ...language,
    langCode: parsePersistedLangCode(language.langCode),
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z'
  }))

  MockUseDataApiUtils.mockQueryResult('/translate/languages', { data: languages, error })
}
