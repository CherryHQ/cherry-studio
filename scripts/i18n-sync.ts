import * as fs from 'fs'
import * as path from 'path'

import { type LocaleKeySpec, localeKeySpec } from './i18n-plurals'
import { sortedObjectByKeys } from './sort'

const baseLocale = process.env.TRANSLATION_BASE_LOCALE ?? 'en-us'
const baseFileName = `${baseLocale}.json`

const catalogDirectories = [
  path.join(__dirname, '../src/renderer/i18n/locales'),
  path.join(__dirname, '../src/main/i18n/locales'),
  path.join(__dirname, '../packages/file-preview/src/locales')
]

/** Catalogs are flat: every key is a dotted path mapping straight to its translated string. */
type I18N = { [key: string]: string }

/**
 * Sync target catalog to match its expected key set (see i18n-plurals.ts)
 * 1. Add required keys missing in target (with '[to be translated]' and the English source text)
 * 2. Remove keys the target may not contain; the locale's own plural forms are kept
 */
function sync(target: I18N, template: I18N, spec: LocaleKeySpec): void {
  for (const key of spec.required) {
    if (!(key in target)) {
      target[key] = `[to be translated]:${template[spec.sourceKey.get(key) ?? key]}`
      console.log(`Added new property: ${key}`)
    }
  }

  for (const targetKey in target) {
    if (!spec.allowed.has(targetKey)) {
      console.log(`Removed excess property: ${targetKey}`)
      delete target[targetKey]
    }
  }
}

function syncCatalog(localesDir: string) {
  const baseFilePath = path.join(localesDir, baseFileName)
  if (!fs.existsSync(baseFilePath)) {
    console.error(`Base locale file ${baseFileName} does not exist, please check path or filename`)
    return
  }

  const baseContent = fs.readFileSync(baseFilePath, 'utf-8')
  let baseJson: I18N = {}
  try {
    baseJson = JSON.parse(baseContent)
  } catch (error) {
    console.error(`Error parsing ${baseFileName}. ${error}`)
    return
  }

  // Sort base locale
  const sortedJson = sortedObjectByKeys(baseJson)
  if (JSON.stringify(baseJson) !== JSON.stringify(sortedJson)) {
    try {
      fs.writeFileSync(baseFilePath, JSON.stringify(sortedJson, null, 2) + '\n', 'utf-8')
      console.log(`Base locale has been sorted`)
    } catch (error) {
      console.error(`Error writing ${baseFilePath}.`, error)
      return
    }
  }

  const files = fs
    .readdirSync(localesDir)
    .filter((file) => file.endsWith('.json') && file !== baseFileName)
    .map((filename) => path.join(localesDir, filename))

  // Sync keys
  for (const filePath of files) {
    const filename = path.basename(filePath)
    let targetJson: I18N = {}
    try {
      const fileContent = fs.readFileSync(filePath, 'utf-8')
      targetJson = JSON.parse(fileContent)
    } catch (error) {
      console.error(`Error parsing ${filename}, skipping this file.`, error)
      continue
    }

    sync(targetJson, baseJson, localeKeySpec(baseJson, filePath))

    const sortedJson = sortedObjectByKeys(targetJson)

    try {
      fs.writeFileSync(filePath, JSON.stringify(sortedJson, null, 2) + '\n', 'utf-8')
      console.log(`File ${filename} has been sorted and synced to match base locale content`)
    } catch (error) {
      console.error(`Error writing ${filename}. ${error}`)
    }
  }
}

for (const localesDir of catalogDirectories) {
  syncCatalog(localesDir)
}
