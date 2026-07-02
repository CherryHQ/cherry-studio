import * as fs from 'fs'
import * as path from 'path'

/**
 * Resolve zh-CN UI strings at runtime from the renderer locale file, so specs track i18n
 * changes instead of hardcoding literals (the golden profile is zh-CN). Mirrors how the
 * previous YAML runner resolved `i18n:` keys.
 */
const LOCALE_PATH = process.env.CHERRY_E2E_LOCALE ?? path.join(process.cwd(), 'src/renderer/i18n/locales/zh-cn.json')

let locale: Record<string, unknown> | undefined

function load(): Record<string, unknown> {
  if (!locale) {
    locale = JSON.parse(fs.readFileSync(LOCALE_PATH, 'utf8')) as Record<string, unknown>
  }
  return locale
}

/** Resolve a dotted i18n key (e.g. `knowledge.data_source.toolbar.add`) to its zh-CN string. */
export function t(key: string): string {
  const value = key.split('.').reduce<unknown>((node, part) => {
    return node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined
  }, load())
  if (typeof value !== 'string') {
    throw new Error(`i18n key "${key}" not found in ${LOCALE_PATH}`)
  }
  return value
}
