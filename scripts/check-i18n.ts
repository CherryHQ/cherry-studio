import * as fs from 'fs'
import * as path from 'path'

import { sortedObjectByKeys } from './sort'

const translationsDir = path.join(__dirname, '../src/renderer/src/i18n/locales')
const baseLocale = 'zh-cn'
const baseFileName = `${baseLocale}.json`
const baseFilePath = path.join(translationsDir, baseFileName)

type I18NValue = string | { [key: string]: I18NValue }
type I18N = { [key: string]: I18NValue }

/**
 * 递归检查并同步目标对象与模板对象的键值结构
 * 1. 如果目标对象缺少模板对象中的键，抛出错误
 * 2. 如果目标对象存在模板对象中不存在的键，抛出错误
 * 3. 对于嵌套对象，递归执行同步操作
 *
 * 该函数用于确保所有翻译文件与基准模板（通常是中文翻译文件）保持完全一致的键值结构。
 * 任何结构上的差异都会导致错误被抛出，以便及时发现和修复翻译文件中的问题。
 *
 * @param target 需要检查的目标翻译对象
 * @param template 作为基准的模板对象（通常是中文翻译文件）
 * @throws {Error} 当发现键值结构不匹配时抛出错误
 */
function checkRecursively(target: I18N, template: I18N): void {
  for (const key in template) {
    if (!(key in target)) {
      throw new Error(`缺少属性 ${key}`)
    }
    if (key.includes('.')) {
      throw new Error(`应该使用严格嵌套结构 ${key}`)
    }
    if (typeof template[key] === 'object' && template[key] !== null) {
      if (typeof target[key] !== 'object' || target[key] === null) {
        throw new Error(`属性 ${key} 不是对象`)
      }
      // 递归检查子对象
      checkRecursively(target[key], template[key])
    }
  }

  // 删除 target 中存在但 template 中没有的 key
  for (const targetKey in target) {
    if (!(targetKey in template)) {
      throw new Error(`多余属性 ${targetKey}`)
    }
  }
}

function isSortedI18N(obj: I18N): boolean {
  // fs.writeFileSync('./test_origin.json', JSON.stringify(obj))
  // fs.writeFileSync('./test_sorted.json', JSON.stringify(sortedObjectByKeys(obj)))
  return JSON.stringify(obj) === JSON.stringify(sortedObjectByKeys(obj))
}

/**
 * 检查 JSON 对象中是否存在重复键，并收集所有重复键
 * @param obj 要检查的对象
 * @returns 返回重复键的数组（若无重复则返回空数组）
 */
function checkDuplicateKeys(obj: I18N): string[] {
  const keys = new Set<string>()
  const duplicateKeys: string[] = []

  const checkObject = (obj: I18N, path: string = '') => {
    for (const key in obj) {
      const fullPath = path ? `${path}.${key}` : key

      if (keys.has(fullPath)) {
        // 发现重复键时，添加到数组中（避免重复添加）
        if (!duplicateKeys.includes(fullPath)) {
          duplicateKeys.push(fullPath)
        }
      } else {
        keys.add(fullPath)
      }

      // 递归检查子对象
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
    throw new Error(`主模板文件 ${baseFileName} 不存在，请检查路径或文件名`)
  }

  const baseContent = fs.readFileSync(baseFilePath, 'utf-8')
  let baseJson: I18N = {}
  try {
    baseJson = JSON.parse(baseContent)
  } catch (error) {
    throw new Error(`解析 ${baseFileName} 出错。${error}`)
  }

  // 检查主模板是否存在重复键
  const duplicateKeys = checkDuplicateKeys(baseJson)
  if (duplicateKeys.length > 0) {
    throw new Error(`主模板文件 ${baseFileName} 存在以下重复键：\n${duplicateKeys.join('\n')}`)
  }

  // 检查主模板是否有序
  if (!isSortedI18N(baseJson)) {
    throw new Error(`主模板文件 ${baseFileName} 的键值未按字典序排序。`)
  }

  const files = fs.readdirSync(translationsDir).filter((file) => file.endsWith('.json') && file !== baseFileName)

  // 同步键
  for (const file of files) {
    const filePath = path.join(translationsDir, file)
    let targetJson: I18N = {}
    try {
      const fileContent = fs.readFileSync(filePath, 'utf-8')
      targetJson = JSON.parse(fileContent)
    } catch (error) {
      throw new Error(`解析 ${file} 出错。`)
    }

    // 检查有序性
    if (!isSortedI18N(targetJson)) {
      throw new Error(`翻译文件 ${file} 的键值未按字典序排序。`)
    }

    try {
      checkRecursively(targetJson, baseJson)
    } catch (e) {
      console.error(e)
      throw new Error(`在检查 ${filePath} 时出错`)
    }
  }
}

export function main() {
  try {
    checkTranslations()
    console.log('i18n 检查已通过')
  } catch (e) {
    console.error(e)
    throw new Error(`检查未通过。尝试运行 yarn sync:i18n 以解决问题。`)
  }
}

main()
