import * as fs from 'fs'
import * as path from 'path'

import { sortedObjectByKeys } from './sort'

const baseLocale = process.env.BASE_LOCALE ?? 'zh-cn'
const baseFileName = `${baseLocale}.json`

const rendererLocalesDir = path.join(__dirname, '../src/renderer/i18n/locales')
const mainI18nDir = path.join(__dirname, '../src/main/i18n')
const mainSrcDir = path.join(__dirname, '../src/main')

type I18NValue = string | { [key: string]: I18NValue }
type I18N = { [key: string]: I18NValue }

/**
 * 递归检查目标对象与模板对象的键值结构是否完全一致（缺键、多键、嵌套结构不符都会抛错）。
 * 用于确保所有翻译文件与基准模板（中文翻译文件）保持相同的键值结构。
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
      checkRecursively(target[key] as I18N, template[key] as I18N)
    }
  }

  for (const targetKey in target) {
    if (!(targetKey in template)) {
      throw new Error(`多余属性 ${targetKey}`)
    }
  }
}

function isSortedI18N(obj: I18N): boolean {
  return JSON.stringify(obj) === JSON.stringify(sortedObjectByKeys(obj))
}

/**
 * 检查 JSON 对象中是否存在重复键，并收集所有重复键（若无重复则返回空数组）。
 */
function checkDuplicateKeys(obj: I18N): string[] {
  const keys = new Set<string>()
  const duplicateKeys: string[] = []

  const checkObject = (obj: I18N, path: string = '') => {
    for (const key in obj) {
      const fullPath = path ? `${path}.${key}` : key
      if (keys.has(fullPath)) {
        if (!duplicateKeys.includes(fullPath)) {
          duplicateKeys.push(fullPath)
        }
      } else {
        keys.add(fullPath)
      }
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        checkObject(obj[key] as I18N, fullPath)
      }
    }
  }

  checkObject(obj)
  return duplicateKeys
}

function readI18N(filePath: string): I18N {
  if (!fs.existsSync(filePath)) {
    throw new Error(`文件 ${filePath} 不存在，请检查路径或文件名`)
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch (error) {
    throw new Error(`解析 ${filePath} 出错。${error}`)
  }
}

/**
 * 校验一组翻译文件：基准模板无重复键且有序，其余文件有序且与基准结构完全一致。
 *
 * @param label 分组名（用于报错信息，如 renderer / main）
 * @param baseFilePath 基准模板文件（通常是中文翻译）
 * @param files 该组需要校验的全部翻译文件（含基准模板本身）
 */
function checkCatalog(label: string, baseFilePath: string, files: string[]): I18N {
  const baseJson = readI18N(baseFilePath)

  const duplicateKeys = checkDuplicateKeys(baseJson)
  if (duplicateKeys.length > 0) {
    throw new Error(`[${label}] 主模板 ${path.basename(baseFilePath)} 存在以下重复键：\n${duplicateKeys.join('\n')}`)
  }
  if (!isSortedI18N(baseJson)) {
    throw new Error(`[${label}] 主模板 ${path.basename(baseFilePath)} 的键值未按字典序排序。`)
  }

  for (const filePath of files) {
    if (path.resolve(filePath) === path.resolve(baseFilePath)) continue
    const targetJson = readI18N(filePath)
    if (!isSortedI18N(targetJson)) {
      throw new Error(`[${label}] 翻译文件 ${path.basename(filePath)} 的键值未按字典序排序。`)
    }
    try {
      checkRecursively(targetJson, baseJson)
    } catch (e) {
      console.error(e)
      throw new Error(`[${label}] 在检查 ${filePath} 时出错`)
    }
  }

  return baseJson
}

function listJsonFiles(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => path.join(dir, file))
}

function keyExists(base: I18N, key: string): boolean {
  let current: I18NValue | undefined = base
  for (const segment of key.split('.')) {
    if (current == null || typeof current !== 'object' || !(segment in current)) {
      return false
    }
    current = current[segment]
  }
  return typeof current === 'string'
}

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      // Skip test folders and the i18n module itself (the catalog is the source of truth there).
      if (entry.name === '__tests__' || entry.name === 'i18n') continue
      collectSourceFiles(path.join(dir, entry.name), acc)
    } else if (/\.tsx?$/.test(entry.name)) {
      acc.push(path.join(dir, entry.name))
    }
  }
  return acc
}

/**
 * Verify that every `t('some.key')` call in files that import `t` from `@main/i18n`
 * resolves to a string in the main catalog. This catches the common drift where main code
 * starts using a key the small main catalog does not carry.
 *
 * A non-literal key — `t(someVar)`, a template string, a ternary — cannot be checked
 * against the catalog statically, so it is reported as a loud failure rather than skipped
 * silently: main code must use literal keys so this guard can cover them.
 *
 * Keys accessed through `getI18n()` subtree destructuring (app menu / tray / dialog
 * namespaces) are guaranteed structurally by the catalog check above and are not
 * statically re-verified here.
 */
function checkMainKeyCoverage(mainBaseJson: I18N): void {
  const importsMainT = /import\s*(?:type\s*)?\{[^}]*\bt\b[^}]*\}\s*from\s*['"]@main\/i18n['"]/
  const anyTCall = /(?<![\w.])t\(/g
  const literalTCall = /^t\(\s*(['"])([\w.]+)\1/

  const missing = new Set<string>()
  const dynamic = new Set<string>()
  for (const file of collectSourceFiles(mainSrcDir)) {
    const content = fs.readFileSync(file, 'utf-8')
    if (!importsMainT.test(content)) continue
    const rel = path.relative(mainSrcDir, file)
    for (const call of content.matchAll(anyTCall)) {
      if (call.index === undefined) continue
      const literal = literalTCall.exec(content.slice(call.index))
      if (!literal) {
        const snippet = content
          .slice(call.index, call.index + 40)
          .split('\n')[0]
          .trim()
        dynamic.add(`${snippet}…  (${rel})`)
        continue
      }
      const key = literal[2]
      if (!keyExists(mainBaseJson, key)) {
        missing.add(`${key}  (${rel})`)
      }
    }
  }

  const errors: string[] = []
  if (dynamic.size > 0) {
    errors.push(`main 源码存在无法静态校验的非字面量 t() 调用（请改用字面量 key）：\n${[...dynamic].join('\n')}`)
  }
  if (missing.size > 0) {
    errors.push(`main 源码使用了 main catalog（src/main/i18n）中不存在的 i18n key：\n${[...missing].join('\n')}`)
  }
  if (errors.length > 0) {
    throw new Error(errors.join('\n\n'))
  }
}

function checkTranslations(): void {
  // Renderer catalog: only the human-authored locales/ files are structure-checked, matching
  // historical behavior (the machine-translated translate/ files are validated by the sync job).
  checkCatalog('renderer', path.join(rendererLocalesDir, baseFileName), listJsonFiles(rendererLocalesDir))

  // Main catalog: all 12 files (locales/ + translate/) must be aligned and sorted.
  const mainBaseFilePath = path.join(mainI18nDir, 'locales', baseFileName)
  const mainFiles = [
    ...listJsonFiles(path.join(mainI18nDir, 'locales')),
    ...listJsonFiles(path.join(mainI18nDir, 'translate'))
  ]
  const mainBaseJson = checkCatalog('main', mainBaseFilePath, mainFiles)

  checkMainKeyCoverage(mainBaseJson)
}

export function main() {
  try {
    checkTranslations()
    console.log('i18n 检查已通过')
  } catch (e) {
    console.error(e)
    throw new Error(`检查未通过。尝试运行 pnpm i18n:sync 以解决问题。`)
  }
}

main()
