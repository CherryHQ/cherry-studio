import EnUs from '../../renderer/src/i18n/locales/en-us.json'
import JaJP from '../../renderer/src/i18n/locales/ja-jp.json'
import RuRu from '../../renderer/src/i18n/locales/ru-ru.json'
import ZhCn from '../../renderer/src/i18n/locales/zh-cn.json'
import ZhTw from '../../renderer/src/i18n/locales/zh-tw.json'
// Machine translation
import elGR from '../../renderer/src/i18n/translate/el-gr.json'
import esES from '../../renderer/src/i18n/translate/es-es.json'
import frFR from '../../renderer/src/i18n/translate/fr-fr.json'
import ptPT from '../../renderer/src/i18n/translate/pt-pt.json'

const locales = Object.fromEntries(
  [
    ['en-US', EnUs],
    ['zh-CN', ZhCn],
    ['zh-TW', ZhTw],
    ['ja-JP', JaJP],
    ['ru-RU', RuRu],
    ['el-GR', elGR],
    ['es-ES', esES],
    ['fr-FR', frFR],
    ['pt-PT', ptPT]
  ].map(([locale, translation]) => [locale, { translation }])
)

export { locales }
