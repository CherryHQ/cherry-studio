import NodeSeeding from './nodeSeeding'
import PreferenceSeeding from './preferenceSeeding'
import TranslateLanguageSeeding from './translateLanguageSeeding'

const seedingList = {
  preference: PreferenceSeeding,
  node: NodeSeeding,
  translateLanguage: TranslateLanguageSeeding
}

export default seedingList
