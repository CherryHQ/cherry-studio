import EnUs from '../../renderer/src/i18n/locales/en-us.json'
import JaJP from '../../renderer/src/i18n/locales/ja-jp.json'
import RuRu from '../../renderer/src/i18n/locales/ru-ru.json'
import ZhCn from '../../renderer/src/i18n/locales/zh-cn.json'
import ZhTw from '../../renderer/src/i18n/locales/zh-tw.json'

const locales = Object.fromEntries(
  [
    ['en-US', EnUs],
    ['zh-CN', ZhCn],
    ['zh-TW', ZhTw],
    ['ja-JP', JaJP],
    ['ru-RU', RuRu]
  ].map(([locale, translation]) => [locale, { translation }])
)

export { locales }
