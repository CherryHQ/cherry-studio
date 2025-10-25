import * as fs from 'fs'
import * as path from 'path'

import { sortedObjectByKeys } from './sort'

const localesDir = path.join(__dirname, '../src/renderer/src/i18n/locales')
const translateDir = path.join(__dirname, '../src/renderer/src/i18n/translate')
const baseLocale = process.env.TRANSLATION_BASE_LOCALE ?? 'en-us'
const baseFileName = `${baseLocale}.json`
const baseFilePath = path.join(localesDir, baseFileName)

type I18NValue = string | { [key: string]: I18NValue }
type I18N = { [key: string]: I18NValue }

/**
 * Recursively sync target object to match template object structure
 * 1. Add keys that exist in template but missing in target (with '[to be translated]')
 * 2. Remove keys that exist in target but not in template
 * 3. Recursively sync nested objects
 *
 * @param target Target object (language object to be updated)
 * @param template Base locale object (Chinese)
 * @returns Returns whether target was updated
 */
function syncRecursively(target: I18N, template: I18N): void {
  // Add keys that exist in template but missing in target
  for (const key in template) {
    if (!(key in target)) {
      target[key] =
        typeof template[key] === 'object' && template[key] !== null ? {} : `[to be translated]:${template[key]}`
      console.log(`Added new property: ${key}`)
    }
    if (typeof template[key] === 'object' && template[key] !== null) {
      if (typeof target[key] !== 'object' || target[key] === null) {
        target[key] = {}
      }
      // Recursively sync nested objects
      syncRecursively(target[key], template[key])
    }
  }

  // Remove keys that exist in target but not in template
  for (const targetKey in target) {
    if (!(targetKey in template)) {
      console.log(`Removed excess property: ${targetKey}`)
      delete target[targetKey]
    }
  }
}

/**
 * Check JSON object for duplicate keys and collect all duplicates
 * @param obj Object to check
 * @returns Returns array of duplicate keys (empty array if no duplicates)
 */
function checkDuplicateKeys(obj: I18N): string[] {
  const keys = new Set<string>()
  const duplicateKeys: string[] = []

  const checkObject = (obj: I18N, path: string = '') => {
    for (const key in obj) {
      const fullPath = path ? `${path}.${key}` : key

      if (keys.has(fullPath)) {
        // When duplicate key found, add to array (avoid duplicate additions)
        if (!duplicateKeys.includes(fullPath)) {
          duplicateKeys.push(fullPath)
        }
      } else {
        keys.add(fullPath)
      }

      // Recursively check nested objects
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        checkObject(obj[key], fullPath)
      }
    }
  }

  checkObject(obj)
  return duplicateKeys
}

function syncTranslations() {
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

  // Check if base locale has duplicate keys
  const duplicateKeys = checkDuplicateKeys(baseJson)
  if (duplicateKeys.length > 0) {
    throw new Error(`Base locale file ${baseFileName} has the following duplicate keys:\n${duplicateKeys.join('\n')}`)
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

  const localeFiles = fs
    .readdirSync(localesDir)
    .filter((file) => file.endsWith('.json') && file !== baseFileName)
    .map((filename) => path.join(localesDir, filename))
  const translateFiles = fs
    .readdirSync(translateDir)
    .filter((file) => file.endsWith('.json') && file !== baseFileName)
    .map((filename) => path.join(translateDir, filename))
  const files = [...localeFiles, ...translateFiles]

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

    syncRecursively(targetJson, baseJson)

    const sortedJson = sortedObjectByKeys(targetJson)

    try {
      fs.writeFileSync(filePath, JSON.stringify(sortedJson, null, 2) + '\n', 'utf-8')
      console.log(`File ${filename} has been sorted and synced to match base locale content`)
    } catch (error) {
      console.error(`Error writing ${filename}. ${error}`)
    }
  }
}

syncTranslations()
