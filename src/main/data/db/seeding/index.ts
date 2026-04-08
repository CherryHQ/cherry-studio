import FileEntrySeeding from './fileEntrySeeding'
import PreferenceSeeding from './preferenceSeeding'
import TranslateLanguageSeeding from './translateLanguageSeeding'

const seedingList = {
  preference: PreferenceSeeding,
  fileEntry: FileEntrySeeding,
  translateLanguage: TranslateLanguageSeeding
}

export default seedingList
