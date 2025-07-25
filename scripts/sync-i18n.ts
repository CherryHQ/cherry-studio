import * as fs from 'fs'
import * as path from 'path'

import { sortedObjectByKeys } from './sort'

const localesDir = path.join(__dirname, '../src/renderer/src/i18n/locales')
const translateDir = path.join(__dirname, '../src/renderer/src/i18n/translate')
const baseLocale = 'zh-cn'
const baseFileName = `${baseLocale}.json`
const baseFilePath = path.join(localesDir, baseFileName)

type I18NValue = string | { [key: string]: I18NValue }
type I18N = { [key: string]: I18NValue }

/**
 * 递归同步 target 对象，使其与 template 对象保持一致
 * 1. 如果 template 中存在 target 中缺少的 key，则添加（'[to be translated]'）
 * 2. 如果 target 中存在 template 中不存在的 key，则删除
 * 3. 对于子对象，递归同步
 *
 * @param target 目标对象（需要更新的语言对象）
 * @param template 主模板对象（中文）
 * @returns 返回是否对 target 进行了更新
 */
function syncRecursively(target: I18N, template: I18N): void {
  // 添加 template 中存在但 target 中缺少的 key
  for (const key in template) {
    if (!(key in target)) {
      target[key] =
        typeof template[key] === 'object' && template[key] !== null ? {} : `[to be translated]:${template[key]}`
      console.log(`添加新属性：${key}`)
    }
    if (typeof template[key] === 'object' && template[key] !== null) {
      if (typeof target[key] !== 'object' || target[key] === null) {
        target[key] = {}
      }
      // 递归同步子对象
      syncRecursively(target[key], template[key])
    }
  }

  // 删除 target 中存在但 template 中没有的 key
  for (const targetKey in target) {
    if (!(targetKey in template)) {
      console.log(`移除多余属性：${targetKey}`)
      delete target[targetKey]
    }
  }
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

function syncTranslations() {
  if (!fs.existsSync(baseFilePath)) {
    console.error(`主模板文件 ${baseFileName} 不存在，请检查路径或文件名`)
    return
  }

  const baseContent = fs.readFileSync(baseFilePath, 'utf-8')
  let baseJson: I18N = {}
  try {
    baseJson = JSON.parse(baseContent)
  } catch (error) {
    console.error(`解析 ${baseFileName} 出错。${error}`)
    return
  }

  // 检查主模板是否存在重复键
  const duplicateKeys = checkDuplicateKeys(baseJson)
  if (duplicateKeys.length > 0) {
    throw new Error(`主模板文件 ${baseFileName} 存在以下重复键：\n${duplicateKeys.join('\n')}`)
  }

  // 为主模板排序
  const sortedJson = sortedObjectByKeys(baseJson)
  if (JSON.stringify(baseJson) !== JSON.stringify(sortedJson)) {
    try {
      fs.writeFileSync(baseFilePath, JSON.stringify(sortedJson, null, 2) + '\n', 'utf-8')
      console.log(`主模板已排序`)
    } catch (error) {
      console.error(`写入 ${baseFilePath} 出错。`, error)
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

  // 同步键
  for (const filePath of files) {
    const filename = path.basename(filePath)
    let targetJson: I18N = {}
    try {
      const fileContent = fs.readFileSync(filePath, 'utf-8')
      targetJson = JSON.parse(fileContent)
    } catch (error) {
      console.error(`解析 ${filename} 出错，跳过此文件。`, error)
      continue
    }

    syncRecursively(targetJson, baseJson)

    const sortedJson = sortedObjectByKeys(targetJson)

    try {
      fs.writeFileSync(filePath, JSON.stringify(sortedJson, null, 2) + '\n', 'utf-8')
      console.log(`文件 ${filename} 已排序并同步更新为主模板的内容`)
    } catch (error) {
      console.error(`写入 ${filename} 出错。${error}`)
    }
  }
}

syncTranslations()
