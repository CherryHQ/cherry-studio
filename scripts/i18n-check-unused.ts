import * as fs from 'fs'
import * as path from 'path'
import * as readline from 'readline/promises'
import { pathToFileURL } from 'url'

import { Command } from 'commander'
import { type CallExpression, Node, Project, type SourceFile } from 'ts-morph'

import { COMMAND_DEFINITIONS } from '../src/shared/utils/command/definitions'
import { sortedObjectByKeys } from './sort'

const ROOT_DIR = path.resolve(__dirname, '..')
const BASE_LOCALE = process.env.TRANSLATION_BASE_LOCALE ?? 'en-us'
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

/** Catalogs are flat: every key is a dotted path mapping straight to its translated string. */
export type I18N = { [key: string]: string }

export interface I18nCatalogConfig {
  name: 'renderer' | 'main'
  localesDir: string
  sourceDirs: string[]
}

const I18N_CATALOGS: I18nCatalogConfig[] = [
  {
    name: 'renderer',
    localesDir: path.join(ROOT_DIR, 'src/renderer/i18n/locales'),
    sourceDirs: ['src/renderer', 'src/main', 'src/shared', 'packages'].map((dir) => path.join(ROOT_DIR, dir))
  },
  {
    name: 'main',
    localesDir: path.join(ROOT_DIR, 'src/main/i18n/locales'),
    sourceDirs: [path.join(ROOT_DIR, 'src/main')]
  }
]

export interface UnusedI18nResult {
  allKeys: string[]
  usedKeys: string[]
  unusedKeys: string[]
  groupedUnusedKeys: Record<string, string[]>
}

export interface CliOptions {
  all?: boolean
  clean?: boolean
  failOnUnused?: boolean
  groups?: string
  json?: boolean
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
  for (const definition of COMMAND_DEFINITIONS) {
    for (const key of [definition.titleKey, definition.categoryKey]) {
      if (localeKeys.has(key)) usedKeys.add(key)
    }
  }
}

export function collectUsedI18nKeysFromSource(sourceFile: SourceFile, localeKeys: Set<string>): Set<string> {
  const usedKeys = new Set<string>()
  const topLevelNamespaces = new Set([...localeKeys].map((key) => key.split('.')[0]))
  const isI18nLabelFile = sourceFile.getFilePath().endsWith(path.join('src/renderer/i18n/label.ts'))

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
      const namespace = node.getExpression().getText()
      if (!topLevelNamespaces.has(namespace)) return

      const key = `${namespace}.${node.getName()}`
      if (localeKeys.has(key)) usedKeys.add(key)
    }
  })

  return usedKeys
}

export function collectUsedMainI18nKeysFromSource(sourceFile: SourceFile, localeKeys: Set<string>): Set<string> {
  const usedKeys = new Set<string>()
  const tImport = sourceFile
    .getImportDeclarations()
    .filter((declaration) => declaration.getModuleSpecifierValue() === '@main/i18n')
    .flatMap((declaration) => declaration.getNamedImports())
    .find((specifier) => specifier.getName() === 't')
  if (!tImport) return usedKeys

  const tName = tImport.getAliasNode()?.getText() ?? 't'
  sourceFile.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return

    const expression = node.getExpression()
    if (!Node.isIdentifier(expression) || expression.getText() !== tName) return

    const key = getStringValue(node.getArguments()[0])
    if (key && localeKeys.has(key)) usedKeys.add(key)
  })

  return usedKeys
}

function collectUsedKeys(
  sourceFiles: string[],
  localeKeys: Set<string>,
  collectFromSource: (sourceFile: SourceFile, localeKeys: Set<string>) => Set<string>,
  includeShortcutReferences: boolean
): Set<string> {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: { jsx: 2 }
  })
  const usedKeys = new Set<string>()

  if (includeShortcutReferences) collectShortcutReferences(localeKeys, usedKeys)

  for (const filePath of sourceFiles) {
    try {
      const sourceFile = project.addSourceFileAtPath(filePath)
      for (const key of collectFromSource(sourceFile, localeKeys)) {
        usedKeys.add(key)
      }
      project.removeSourceFile(sourceFile)
    } catch (error) {
      console.error(`Error parsing ${path.relative(ROOT_DIR, filePath)}:`, error)
    }
  }

  return usedKeys
}

export function collectUsedI18nKeys(sourceFiles: string[], localeKeys: Set<string>): Set<string> {
  return collectUsedKeys(sourceFiles, localeKeys, collectUsedI18nKeysFromSource, true)
}

export function collectUsedMainI18nKeys(sourceFiles: string[], localeKeys: Set<string>): Set<string> {
  const productionFiles = sourceFiles.filter((filePath) => {
    const pathParts = path.normalize(filePath).split(path.sep)
    return !pathParts.includes('__tests__') && !/\.(?:test|spec)\.tsx?$/.test(path.basename(filePath))
  })

  return collectUsedKeys(productionFiles, localeKeys, collectUsedMainI18nKeysFromSource, false)
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
  const allKeys = Object.keys(baseLocale).sort()
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
  const allKeys = Object.keys(baseLocale).sort()
  const localeKeys = new Set(allKeys)
  return createUnusedI18nResult(baseLocale, collectUsedI18nKeys(sourceFiles, localeKeys))
}

export function findUnusedMainI18nKeys(baseLocale: I18N, sourceFiles: string[]): UnusedI18nResult {
  const allKeys = Object.keys(baseLocale).sort()
  const localeKeys = new Set(allKeys)
  return createUnusedI18nResult(baseLocale, collectUsedMainI18nKeys(sourceFiles, localeKeys))
}

export function assertNoUnusedI18nKeys(result: UnusedI18nResult, catalogName?: string): void {
  const count = result.unusedKeys.length
  if (count === 0) return

  const noun = count === 1 ? 'key' : 'keys'
  const pronoun = count === 1 ? 'it' : 'them'
  const catalog = catalogName ? ` in the ${catalogName} catalog` : ''
  throw new Error(`Found ${count} unused i18n ${noun}${catalog}. Run \`pnpm i18n:unused\` to review ${pronoun}.`)
}

export function removeI18nKeys(locale: I18N, keys: string[]): I18N {
  const next = structuredClone(locale)
  for (const key of keys) {
    delete next[key]
  }
  return sortedObjectByKeys(next) as I18N
}

function findTranslationFiles(localesDir: string): string[] {
  return fs
    .readdirSync(localesDir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => path.join(localesDir, file))
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

async function promptGroups(catalogName: string, groupedUnusedKeys: Record<string, string[]>): Promise<string[]> {
  const groups = Object.entries(groupedUnusedKeys).sort(([a], [b]) => a.localeCompare(b))
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  try {
    console.log(`\nSelect ${catalogName} groups to clean:`)
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

function cleanTranslationFiles(catalog: I18nCatalogConfig, keys: string[]): void {
  for (const filePath of findTranslationFiles(catalog.localesDir)) {
    const json = readJsonFile(filePath)
    writeJsonFile(filePath, removeI18nKeys(json, keys))
    console.log(`[${catalog.name}] Cleaned ${keys.length} keys from ${path.relative(ROOT_DIR, filePath)}`)
  }
}

export async function runCli(options: CliOptions, catalogs = I18N_CATALOGS): Promise<void> {
  const analyses = catalogs.map((catalog) => {
    const baseLocale = readJsonFile(path.join(catalog.localesDir, `${BASE_LOCALE}.json`))
    const sourceFiles = catalog.sourceDirs.flatMap(findSourceFiles)
    const result =
      catalog.name === 'main'
        ? findUnusedMainI18nKeys(baseLocale, sourceFiles)
        : findUnusedI18nKeys(baseLocale, sourceFiles)
    return { catalog, result }
  })

  if (options.json) {
    console.log(
      JSON.stringify(Object.fromEntries(analyses.map(({ catalog, result }) => [catalog.name, result])), null, 2)
    )
  } else {
    for (const { catalog, result } of analyses) {
      console.log(
        `[${catalog.name}] Found ${result.unusedKeys.length} unused i18n keys out of ${result.allKeys.length} total keys.`
      )
      if (result.unusedKeys.length > 0) {
        console.log(formatGroupSummary(result.groupedUnusedKeys))
      }
    }
  }

  if (options.failOnUnused) {
    for (const { catalog, result } of analyses) {
      assertNoUnusedI18nKeys(result, catalog.name)
    }
  }

  if (!options.clean) return

  const groups = parseGroups(options.groups)
  for (const { catalog, result } of analyses) {
    if (result.unusedKeys.length === 0) continue

    const selectedGroups = options.all
      ? Object.keys(result.groupedUnusedKeys).sort()
      : groups.length > 0
        ? groups
        : await promptGroups(catalog.name, result.groupedUnusedKeys)
    const keysToRemove = options.all
      ? selectAllKeys(result.groupedUnusedKeys)
      : selectKeysByGroups(result.groupedUnusedKeys, selectedGroups)

    if (keysToRemove.length === 0) {
      console.log(`[${catalog.name}] No matching unused i18n keys selected.`)
      continue
    }

    cleanTranslationFiles(catalog, keysToRemove)
    console.log(`[${catalog.name}] Removed ${keysToRemove.length} unused i18n keys from ${selectedGroups.join(', ')}.`)
  }
}

async function main() {
  const program = new Command()
    .description('Find unused renderer and main i18n keys and optionally clean them by top-level namespace')
    .option('--all', 'with --clean, remove all unused keys without prompting')
    .option('--clean', 'remove selected unused keys from all translation files')
    .option('--fail-on-unused', 'exit with an error when unused keys are found')
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
