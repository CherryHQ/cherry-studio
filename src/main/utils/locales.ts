import { configManager } from '@main/services/ConfigManager'

import EnUs from '../../renderer/src/i18n/locales/en-us.json'
import ZhCn from '../../renderer/src/i18n/locales/zh-cn.json'
import ZhTw from '../../renderer/src/i18n/locales/zh-tw.json'
// Machine translation
import deDE from '../../renderer/src/i18n/translate/de-de.json'
import elGR from '../../renderer/src/i18n/translate/el-gr.json'
import esES from '../../renderer/src/i18n/translate/es-es.json'
import frFR from '../../renderer/src/i18n/translate/fr-fr.json'
import JaJP from '../../renderer/src/i18n/translate/ja-jp.json'
import ptPT from '../../renderer/src/i18n/translate/pt-pt.json'
import roRO from '../../renderer/src/i18n/translate/ro-ro.json'
import RuRu from '../../renderer/src/i18n/translate/ru-ru.json'

const locales = Object.fromEntries(
  [
    ['en-US', EnUs],
    ['zh-CN', ZhCn],
    ['zh-TW', ZhTw],
    ['ja-JP', JaJP],
    ['ru-RU', RuRu],
    ['de-DE', deDE],
    ['el-GR', elGR],
    ['es-ES', esES],
    ['fr-FR', frFR],
    ['pt-PT', ptPT],
    ['ro-RO', roRO]
  ].map(([locale, translation]) => [locale, { translation }])
)

/**
 * Get translation by key path (e.g., 'dialog.save_file')
 * This is a simplified version for main process, similar to i18next's t() function
 */
const t = (key: string): string => {
  const locale = locales[configManager.getLanguage()]
  const keys = key.split('.')
  let result: any = locale.translation
  for (const k of keys) {
    result = result?.[k]
    if (result === undefined) {
      return key
    }
  }
  return typeof result === 'string' ? result : key
}

export { locales, t }
