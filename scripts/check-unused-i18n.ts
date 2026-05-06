import { Command } from 'commander'
import * as fs from 'fs'
import * as path from 'path'
import * as readline from 'readline/promises'
import { type CallExpression, Node, Project, type SourceFile } from 'ts-morph'
import { pathToFileURL } from 'url'

import { SHORTCUT_DEFINITIONS } from '../packages/shared/shortcuts/definitions'
import { sortedObjectByKeys } from './sort'

const ROOT_DIR = path.resolve(__dirname, '..')
const LOCALES_DIR = path.join(ROOT_DIR, 'src/renderer/src/i18n/locales')
const TRANSLATE_DIR = path.join(ROOT_DIR, 'src/renderer/src/i18n/translate')
const BASE_LOCALE = 'zh-cn'
const BASE_LOCALE_PATH = path.join(LOCALES_DIR, `${BASE_LOCALE}.json`)
const SCAN_DIRS = ['src/renderer/src', 'src/main', 'packages'].map((dir) => path.join(ROOT_DIR, dir))
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx'])
const IGNORED_DIRS = new Set(['.git', '.turbo', 'dist', 'node_modules', 'out', 'release', '.vite'])
const KEY_PROPERTY_NAMES = new Set([
  'descriptionKey',
  'i18nKey',
  'label',
  'labelKey',
  'messageKey',
  'placeholderKey',
  'titleKey',
  'tooltipKey'
])
const COMMENT_T_CALL_RE = /\bt\s*\(\s*['"`]([^'"`]+)['"`]/g
const DOTTED_KEY_RE = /(?<![\w.-])([A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)+)(?![\w.-])/g
const DERIVED_KEY_SUFFIXES = ['_one', '_other']

export type I18NValue = string | { [key: string]: I18NValue }
export type I18N = { [key: string]: I18NValue }

export interface UnusedI18nResult {
  allKeys: string[]
  usedKeys: string[]
  unusedKeys: string[]
  groupedUnusedKeys: Record<string, string[]>
}

interface CliOptions {
  all?: boolean
  clean?: boolean
  groups?: string
  json?: boolean
}

function isI18nObject(value: I18NValue): value is I18N {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function flattenI18nKeys(obj: I18N, prefix = ''): string[] {
  const keys: string[] = []

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (isI18nObject(value)) {
      keys.push(...flattenI18nKeys(value, fullKey))
    } else {
      keys.push(fullKey)
    }
  }

  return keys
}

function readJsonFile(filePath: string): I18N {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as I18N
}

function writeJsonFile(filePath: string, json: I18N): void {
  fs.writeFileSync(filePath, `${JSON.stringify(sortedObjectByKeys(json), null, 2)}\n`, 'utf-8')
}

export function findSourceFiles(dir: string): string[] {
  const files: string[] = []
  if (!fs.existsSync(dir)) return files

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue
      files.push(...findSourceFiles(path.join(dir, entry.name)))
      continue
    }

    if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(path.join(dir, entry.name))
    }
  }

  return files
}

function getStringValue(node: Node | undefined): string | null {
  if (!node) return null
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) return node.getLiteralValue()
  return null
}

function collectStringValues(node: Node | undefined): string[] {
  if (!node) return []

  const stringValue = getStringValue(node)
  if (stringValue) return [stringValue]

  if (Node.isConditionalExpression(node)) {
    return [...collectStringValues(node.getWhenTrue()), ...collectStringValues(node.getWhenFalse())]
  }

  return []
}

function getJsxAttributeStringValue(node: Node): string | null {
  if (Node.isStringLiteral(node)) return node.getLiteralValue()
  if (Node.isJsxExpression(node)) return getStringValue(node.getExpression())
  return null
}

function isTranslationCall(node: Node): node is CallExpression {
  if (!Node.isCallExpression(node)) return false

  const expression = node.getExpression()
  if (Node.isIdentifier(expression)) return expression.getText() === 't'
  if (Node.isPropertyAccessExpression(expression)) return expression.getName() === 't'
  return false
}

function getPropertyName(node: Node): string | null {
  if (Node.isIdentifier(node) || Node.isStringLiteral(node)) return node.getText().replace(/^['"]|['"]$/g, '')
  return null
}

function shouldCollectKeyProperty(name: string): boolean {
  return KEY_PROPERTY_NAMES.has(name) || /^[a-zA-Z].*Key$/.test(name)
}

function isKnownLocaleKey(value: string, localeKeys: Set<string>): boolean {
  return value.includes('.') && localeKeys.has(value)
}

function addUsedKey(key: string, localeKeys: Set<string>, usedKeys: Set<string>): void {
  if (localeKeys.has(key)) usedKeys.add(key)

  for (const suffix of DERIVED_KEY_SUFFIXES) {
    const derivedKey = `${key}${suffix}`
    if (localeKeys.has(derivedKey)) usedKeys.add(derivedKey)
  }
}

function addKnownStringValue(value: string | null, localeKeys: Set<string>, usedKeys: Set<string>): void {
  if (!value) return
  addUsedKey(value, localeKeys, usedKeys)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function collectTemplateExpressionMatches(
  node: Node,
  localeKeys: Set<string>,
  topLevelNamespaces: Set<string>,
  usedKeys: Set<string>
): void {
  if (!Node.isTemplateExpression(node)) return

  const parts = [
    node.getHead().getLiteralText(),
    ...node.getTemplateSpans().map((span) => span.getLiteral().getLiteralText())
  ]
  const firstPart = parts[0]
  const namespace = firstPart.split('.')[0]
  if (!namespace || !topLevelNamespaces.has(namespace) || !firstPart.includes('.')) return

  const pattern = new RegExp(`^${parts.map(escapeRegExp).join('.*')}$`)
  for (const key of localeKeys) {
    if (pattern.test(key)) usedKeys.add(key)
  }
}

function collectCommentReferences(sourceFile: SourceFile, localeKeys: Set<string>, usedKeys: Set<string>): void {
  const fullText = sourceFile.getFullText()
  const commentRanges = [
    ...sourceFile.getLeadingCommentRanges(),
    ...sourceFile.getDescendants().flatMap((node) => node.getLeadingCommentRanges())
  ]
  const seenPositions = new Set<number>()

  for (const range of commentRanges) {
    if (seenPositions.has(range.getPos())) continue
    seenPositions.add(range.getPos())

    const comment = fullText.slice(range.getPos(), range.getEnd())
    let match: RegExpExecArray | null
    COMMENT_T_CALL_RE.lastIndex = 0
    while ((match = COMMENT_T_CALL_RE.exec(comment)) !== null) {
      addUsedKey(match[1], localeKeys, usedKeys)
    }
  }
}

function collectExactSourceTextReferences(
  sourceFile: SourceFile,
  localeKeys: Set<string>,
  usedKeys: Set<string>
): void {
  const fullText = sourceFile.getFullText()
  let match: RegExpExecArray | null

  DOTTED_KEY_RE.lastIndex = 0
  while ((match = DOTTED_KEY_RE.exec(fullText)) !== null) {
    addUsedKey(match[1], localeKeys, usedKeys)
  }
}

function collectShortcutReferences(localeKeys: Set<string>, usedKeys: Set<string>): void {
  for (const definition of SHORTCUT_DEFINITIONS) {
    const key = `settings.shortcuts.${definition.labelKey}`
    if (localeKeys.has(key)) usedKeys.add(key)
  }
}

function collectTranslationNamespaceAliases(
  sourceFile: SourceFile,
  topLevelNamespaces: Set<string>
): Map<string, string> {
  const aliases = new Map<string, string>()

  sourceFile.forEachDescendant((node) => {
    if (!Node.isVariableDeclaration(node)) return

    const initializer = node.getInitializer()
    if (!Node.isPropertyAccessExpression(initializer) || initializer.getName() !== 'translation') return

    const nameNode = node.getNameNode()
    if (!Node.isObjectBindingPattern(nameNode)) return

    for (const element of nameNode.getElements()) {
      const propertyNameNode = element.getPropertyNameNode()
      const namespace = propertyNameNode ? getPropertyName(propertyNameNode) : element.getName()
      const localNameNode = element.getNameNode()

      if (!namespace || !topLevelNamespaces.has(namespace) || !Node.isIdentifier(localNameNode)) continue
      aliases.set(localNameNode.getText(), namespace)
    }
  })

  return aliases
}

export function collectUsedI18nKeysFromSource(sourceFile: SourceFile, localeKeys: Set<string>): Set<string> {
  const usedKeys = new Set<string>()
  const topLevelNamespaces = new Set([...localeKeys].map((key) => key.split('.')[0]))
  const isI18nLabelFile = sourceFile.getFilePath().endsWith(path.join('src/renderer/src/i18n/label.ts'))
  const translationNamespaceAliases = collectTranslationNamespaceAliases(sourceFile, topLevelNamespaces)

  collectCommentReferences(sourceFile, localeKeys, usedKeys)
  collectExactSourceTextReferences(sourceFile, localeKeys, usedKeys)

  sourceFile.forEachDescendant((node) => {
    collectTemplateExpressionMatches(node, localeKeys, topLevelNamespaces, usedKeys)

    if (isTranslationCall(node)) {
      for (const key of collectStringValues(node.getArguments()[0])) {
        addKnownStringValue(key, localeKeys, usedKeys)
      }
      return
    }

    if (Node.isJsxAttribute(node) && node.getNameNode().getText() === 'i18nKey') {
      const initializer = node.getInitializer()
      addKnownStringValue(initializer ? getJsxAttributeStringValue(initializer) : null, localeKeys, usedKeys)
      return
    }

    if (Node.isPropertyAssignment(node)) {
      const propertyName = getPropertyName(node.getNameNode())
      const value = getStringValue(node.getInitializer())
      if (propertyName && value && shouldCollectKeyProperty(propertyName) && isKnownLocaleKey(value, localeKeys)) {
        addUsedKey(value, localeKeys, usedKeys)
        return
      }

      if (isI18nLabelFile && value && isKnownLocaleKey(value, localeKeys)) {
        addUsedKey(value, localeKeys, usedKeys)
        return
      }
    }

    if (Node.isPropertyAccessExpression(node) && Node.isIdentifier(node.getExpression())) {
      const expressionName = node.getExpression().getText()
      const namespace = translationNamespaceAliases.get(expressionName) ?? expressionName
      if (!topLevelNamespaces.has(namespace)) return

      const key = `${namespace}.${node.getName()}`
      if (localeKeys.has(key)) usedKeys.add(key)
    }
  })

  return usedKeys
}

export function collectUsedI18nKeys(sourceFiles: string[], localeKeys: Set<string>): Set<string> {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: { jsx: 2 }
  })
  const usedKeys = new Set<string>()

  collectShortcutReferences(localeKeys, usedKeys)

  for (const filePath of sourceFiles) {
    try {
      const sourceFile = project.addSourceFileAtPath(filePath)
      for (const key of collectUsedI18nKeysFromSource(sourceFile, localeKeys)) {
        usedKeys.add(key)
      }
      project.removeSourceFile(sourceFile)
    } catch (error) {
      console.error(`Error parsing ${path.relative(ROOT_DIR, filePath)}:`, error)
    }
  }

  return usedKeys
}

function groupKeys(keys: string[]): Record<string, string[]> {
  return keys.reduce<Record<string, string[]>>((groups, key) => {
    const group = key.split('.')[0]
    groups[group] ??= []
    groups[group].push(key)
    return groups
  }, {})
}

export function createUnusedI18nResult(baseLocale: I18N, usedKeys: Iterable<string>): UnusedI18nResult {
  const allKeys = flattenI18nKeys(baseLocale).sort()
  const usedKeyList = [...usedKeys].filter((key) => allKeys.includes(key)).sort()
  const usedKeySet = new Set(usedKeyList)
  const unusedKeys = allKeys.filter((key) => !usedKeySet.has(key))

  return {
    allKeys,
    usedKeys: usedKeyList,
    unusedKeys,
    groupedUnusedKeys: groupKeys(unusedKeys)
  }
}

export function findUnusedI18nKeys(baseLocale: I18N, sourceFiles: string[]): UnusedI18nResult {
  const allKeys = flattenI18nKeys(baseLocale).sort()
  const localeKeys = new Set(allKeys)
  return createUnusedI18nResult(baseLocale, collectUsedI18nKeys(sourceFiles, localeKeys))
}

function deleteNestedKey(obj: I18N, keyPath: string): void {
  const parts = keyPath.split('.')
  const stack: Array<{ object: I18N; key: string }> = []
  let current = obj

  for (const part of parts.slice(0, -1)) {
    const next = current[part]
    if (!isI18nObject(next)) return
    stack.push({ object: current, key: part })
    current = next
  }

  delete current[parts[parts.length - 1]]

  for (let index = stack.length - 1; index >= 0; index--) {
    const { object, key } = stack[index]
    const value = object[key]
    if (isI18nObject(value) && Object.keys(value).length === 0) {
      delete object[key]
    }
  }
}

export function removeI18nKeys(locale: I18N, keys: string[]): I18N {
  const next = structuredClone(locale)
  for (const key of keys) {
    deleteNestedKey(next, key)
  }
  return sortedObjectByKeys(next) as I18N
}

function findTranslationFiles(): string[] {
  return [LOCALES_DIR, TRANSLATE_DIR].flatMap((dir) =>
    fs.existsSync(dir)
      ? fs
          .readdirSync(dir)
          .filter((file) => file.endsWith('.json'))
          .map((file) => path.join(dir, file))
      : []
  )
}

function parseGroups(groups: string | undefined): string[] {
  return groups
    ? groups
        .split(',')
        .map((group) => group.trim())
        .filter(Boolean)
    : []
}

function formatGroupSummary(groupedUnusedKeys: Record<string, string[]>): string {
  return Object.entries(groupedUnusedKeys)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, keys]) => {
      const examples = keys.slice(0, 5).join(', ')
      const suffix = keys.length > 5 ? ', ...' : ''
      return `- ${group}: ${keys.length} (${examples}${suffix})`
    })
    .join('\n')
}

async function promptGroups(groupedUnusedKeys: Record<string, string[]>): Promise<string[]> {
  const groups = Object.entries(groupedUnusedKeys).sort(([a], [b]) => a.localeCompare(b))
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  try {
    console.log('\nSelect groups to clean:')
    groups.forEach(([group, keys], index) => {
      console.log(`${index + 1}. ${group} (${keys.length})`)
    })

    const answer = await rl.question('Enter group numbers/names separated by comma, or "all": ')
    if (answer.trim().toLowerCase() === 'all') {
      return groups.map(([group]) => group)
    }

    return answer
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const numericIndex = Number(item)
        if (Number.isInteger(numericIndex) && numericIndex >= 1 && numericIndex <= groups.length) {
          return groups[numericIndex - 1][0]
        }
        return item
      })
  } finally {
    rl.close()
  }
}

export function selectKeysByGroups(groupedUnusedKeys: Record<string, string[]>, groups: string[]): string[] {
  const selectedGroups = new Set(groups)
  return Object.entries(groupedUnusedKeys)
    .filter(([group]) => selectedGroups.has(group))
    .flatMap(([, keys]) => keys)
    .sort()
}

function selectAllKeys(groupedUnusedKeys: Record<string, string[]>): string[] {
  return Object.values(groupedUnusedKeys).flat().sort()
}

function cleanTranslationFiles(keys: string[]): void {
  for (const filePath of findTranslationFiles()) {
    const json = readJsonFile(filePath)
    writeJsonFile(filePath, removeI18nKeys(json, keys))
    console.log(`Cleaned ${keys.length} keys from ${path.relative(ROOT_DIR, filePath)}`)
  }
}

export async function runCli(options: CliOptions): Promise<void> {
  const baseLocale = readJsonFile(BASE_LOCALE_PATH)
  const sourceFiles = SCAN_DIRS.flatMap(findSourceFiles)
  const result = findUnusedI18nKeys(baseLocale, sourceFiles)

  if (options.json) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log(`Found ${result.unusedKeys.length} unused i18n keys out of ${result.allKeys.length} total keys.`)
    if (result.unusedKeys.length > 0) {
      console.log(formatGroupSummary(result.groupedUnusedKeys))
    }
  }

  if (!options.clean || result.unusedKeys.length === 0) return

  const groups = parseGroups(options.groups)
  const selectedGroups = options.all
    ? Object.keys(result.groupedUnusedKeys).sort()
    : groups.length > 0
      ? groups
      : await promptGroups(result.groupedUnusedKeys)
  const keysToRemove = options.all
    ? selectAllKeys(result.groupedUnusedKeys)
    : selectKeysByGroups(result.groupedUnusedKeys, selectedGroups)

  if (keysToRemove.length === 0) {
    console.log('No matching unused i18n keys selected.')
    return
  }

  cleanTranslationFiles(keysToRemove)
  console.log(`Removed ${keysToRemove.length} unused i18n keys from ${selectedGroups.join(', ')}.`)
}

async function main() {
  const program = new Command()
    .description('Find unused i18n keys and optionally clean them by top-level namespace')
    .option('--all', 'with --clean, remove all unused keys without prompting')
    .option('--clean', 'remove selected unused keys from all translation files')
    .option('--groups <groups>', 'comma-separated top-level namespaces to clean')
    .option('--json', 'print machine-readable JSON')

  program.parse(process.argv)
  await runCli(program.opts<CliOptions>())
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
