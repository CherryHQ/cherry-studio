import * as fs from 'fs'
import * as path from 'path'

import { sortedObjectByKeys } from './sort'

const translationsDir = path.join(__dirname, '../src/renderer/src/i18n/locales')
const baseLocale = process.env.BASE_LOCALE ?? 'en-us'
const baseFileName = `${baseLocale}.json`
const baseFilePath = path.join(translationsDir, baseFileName)

type I18NValue = string | { [key: string]: I18NValue }
type I18N = { [key: string]: I18NValue }

/**
 * Recursively check and synchronize the key-value structure of target object with template object
 * 1. If target object is missing keys from template object, throw error
 * 2. If target object has keys that don't exist in template object, throw error
 * 3. For nested objects, recursively perform synchronization operation
 *
 * This function ensures all translation files maintain completely consistent key-value structure
 * with the base template (usually the base translation file).
 * Any structural differences will cause errors to be thrown for timely detection and fixing
 * of translation file issues.
 *
 * @param target The target translation object to check
 * @param template The template object used as base (usually the base translation file)
 * @throws {Error} Thrown when key-value structure mismatch is found
 */
function checkRecursively(target: I18N, template: I18N): void {
  for (const key in template) {
    if (!(key in target)) {
      throw new Error(`Missing property ${key}`)
    }
    if (key.includes('.')) {
      throw new Error(`Should use strict nested structure for key ${key}`)
    }
    if (typeof template[key] === 'object' && template[key] !== null) {
      if (typeof target[key] !== 'object' || target[key] === null) {
        throw new Error(`Property ${key} is not an object`)
      }
      // Recursively check child objects
      checkRecursively(target[key], template[key])
    }
  }

  // Remove keys that exist in target but not in template
  for (const targetKey in target) {
    if (!(targetKey in template)) {
      throw new Error(`Extra property ${targetKey}`)
    }
  }
}

function isSortedI18N(obj: I18N): boolean {
  // fs.writeFileSync('./test_origin.json', JSON.stringify(obj))
  // fs.writeFileSync('./test_sorted.json', JSON.stringify(sortedObjectByKeys(obj)))
  return JSON.stringify(obj) === JSON.stringify(sortedObjectByKeys(obj))
}

/**
 * Check for duplicate keys in JSON object and collect all duplicate keys
 * @param obj The object to check
 * @returns Array of duplicate keys (returns empty array if no duplicates)
 */
function checkDuplicateKeys(obj: I18N): string[] {
  const keys = new Set<string>()
  const duplicateKeys: string[] = []

  const checkObject = (obj: I18N, path: string = '') => {
    for (const key in obj) {
      const fullPath = path ? `${path}.${key}` : key

      if (keys.has(fullPath)) {
        // When duplicate key is found, add to array (avoid duplicate additions)
        if (!duplicateKeys.includes(fullPath)) {
          duplicateKeys.push(fullPath)
        }
      } else {
        keys.add(fullPath)
      }

      // Recursively check child objects
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        checkObject(obj[key], fullPath)
      }
    }
  }

  checkObject(obj)
  return duplicateKeys
}

function checkTranslations() {
  if (!fs.existsSync(baseFilePath)) {
    throw new Error(`Base template file ${baseFileName} does not exist, please check path or filename`)
  }

  const baseContent = fs.readFileSync(baseFilePath, 'utf-8')
  let baseJson: I18N = {}
  try {
    baseJson = JSON.parse(baseContent)
  } catch (error) {
    throw new Error(`Error parsing ${baseFileName}. ${error}`)
  }

  // Check if base template has duplicate keys
  const duplicateKeys = checkDuplicateKeys(baseJson)
  if (duplicateKeys.length > 0) {
    throw new Error(`Base template file ${baseFileName} has the following duplicate keys:\n${duplicateKeys.join('\n')}`)
  }

  // Check if base template is sorted
  if (!isSortedI18N(baseJson)) {
    throw new Error(`Base template file ${baseFileName} keys are not sorted in dictionary order.`)
  }

  const files = fs.readdirSync(translationsDir).filter((file) => file.endsWith('.json') && file !== baseFileName)

  // Sync keys
  for (const file of files) {
    const filePath = path.join(translationsDir, file)
    let targetJson: I18N = {}
    try {
      const fileContent = fs.readFileSync(filePath, 'utf-8')
      targetJson = JSON.parse(fileContent)
    } catch (error) {
      throw new Error(`Error parsing ${file}.`)
    }

    // Check if sorted
    if (!isSortedI18N(targetJson)) {
      throw new Error(`Translation file ${file} keys are not sorted.`)
    }

    try {
      checkRecursively(targetJson, baseJson)
    } catch (e) {
      console.error(e)
      throw new Error(`Error while checking ${filePath}`)
    }
  }
}

export function main() {
  try {
    checkTranslations()
    console.log('i18n check passed')
  } catch (e) {
    console.error(e)
    throw new Error(`Check failed. Try running yarn i18n:sync to fix the issue.`)
  }
}

main()
