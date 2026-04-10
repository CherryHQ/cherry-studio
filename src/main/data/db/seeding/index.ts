import PreferenceSeeding from './preferenceSeeding'
import PresetProviderSeeding from './presetProviderSeeding'
import TranslateLanguageSeeding from './translateLanguageSeeding'

const seedingList = {
  preference: PreferenceSeeding,
  translateLanguage: TranslateLanguageSeeding,
  presetProvider: PresetProviderSeeding
}

export default seedingList
