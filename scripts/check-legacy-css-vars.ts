import * as fs from 'node:fs'
import * as path from 'node:path'

import postcss, { type AtRule, type ChildNode, type Declaration, type Root, type Rule } from 'postcss'
import ts from 'typescript'

const REPO_ROOT = path.resolve(__dirname, '..')
const MIGRATION_REGISTRY_PATH = path.join(REPO_ROOT, 'packages/ui/src/styles/migrations/shadcn-v2.json')
const CHECK_EXTENSIONS = new Set(['.css', '.ts', '.tsx'])
const IGNORED_DIR_NAMES = new Set(['.context', '.git', 'build', 'coverage', 'dist', 'node_modules', 'out'])

interface MigrationRule {
  source: string
  target: string | null
  strategy: string
}

interface MigrationRegistry {
  exclude: string[]
  rules: MigrationRule[]
}

function isRendererLegacyAliasSource(source: string): boolean {
  return (
    source.startsWith('--color-') ||
    source.startsWith('--navbar-') ||
    source.startsWith('--modal-') ||
    source.startsWith('--chat-') ||
    source.startsWith('--list-item-')
  )
}

function loadMigrationRegistry(): MigrationRegistry {
  return JSON.parse(fs.readFileSync(MIGRATION_REGISTRY_PATH, 'utf8')) as MigrationRegistry
}

const MIGRATION_REGISTRY = loadMigrationRegistry()
const LEGACY_ALIAS_RULES = MIGRATION_REGISTRY.rules.filter((rule) => isRendererLegacyAliasSource(rule.source))

for (const rule of LEGACY_ALIAS_RULES) {
  if (rule.strategy !== 'exact' || !rule.target) {
    throw new Error(`Legacy compatibility variable ${rule.source} must have an exact migration target`)
  }
}

export const LEGACY_VARS = LEGACY_ALIAS_RULES.map((rule) => rule.source)

const LEGACY_VAR_SET = new Set(LEGACY_VARS)
const EXACT_REPLACEMENTS = new Map(LEGACY_ALIAS_RULES.map((rule) => [rule.source, rule.target as string]))
const OCCURRENCE_PATTERN = new RegExp(`(?<![\\w-])(${LEGACY_VARS.map(escapeRegExp).join('|')})(?![\\w-])`, 'g')

type WritableStream = Pick<typeof process.stdout, 'write'>

interface RunCliOptions {
  env?: NodeJS.ProcessEnv
  stdout?: WritableStream
  stderr?: WritableStream
}

export interface Finding {
  file: string
  line: number
  variable: string
  lineText: string
}

export interface FixSummary {
  filesChanged: number
  replacements: number
}

interface ReplacementResult {
  content: string
  replacements: number
}

interface TextRange {
  start: number
  end: number
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeRepoPath(filePath: string): string {
  return filePath.split(path.sep).join('/')
}

function globToRegExp(pattern: string): RegExp {
  let source = '^'

  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index]

    if (character === '*' && pattern[index + 1] === '*') {
      if (pattern[index + 2] === '/') {
        source += '(?:.*/)?'
        index += 2
      } else {
        source += '.*'
        index += 1
      }
      continue
    }

    if (character === '*') {
      source += '[^/]*'
      continue
    }

    source += escapeRegExp(character)
  }

  return new RegExp(`${source}$`)
}

const MIGRATION_EXCLUDE_PATTERNS = MIGRATION_REGISTRY.exclude.map(globToRegExp)

export function shouldIgnoreFile(filePath: string): boolean {
  const relativePath = normalizeRepoPath(path.relative(REPO_ROOT, path.resolve(filePath)))
  return MIGRATION_EXCLUDE_PATTERNS.some((pattern) => pattern.test(relativePath))
}

function collectFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      if (!IGNORED_DIR_NAMES.has(entry.name)) {
        files.push(...collectFiles(fullPath))
      }
      continue
    }

    if (!CHECK_EXTENSIONS.has(path.extname(entry.name))) continue
    if (shouldIgnoreFile(fullPath)) continue

    files.push(fullPath)
  }

  return files
}

export function collectTargetFiles(targetPath = REPO_ROOT): string[] {
  const stats = fs.statSync(targetPath)

  if (stats.isDirectory()) {
    return collectFiles(targetPath)
  }

  if (!stats.isFile()) return []
  if (!CHECK_EXTENSIONS.has(path.extname(targetPath))) return []
  if (shouldIgnoreFile(targetPath)) return []

  return [targetPath]
}

function isVariableDefinitionLine(line: string, variable: string): boolean {
  return new RegExp(`^\\s*${escapeRegExp(variable)}\\s*:`).test(line)
}

export function isCommentLine(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('*/')
}

function findMatches(text: string, locallyOwned = new Set<string>()): Array<{ index: number; variable: string }> {
  const matches: Array<{ index: number; variable: string }> = []

  for (const match of text.matchAll(OCCURRENCE_PATTERN)) {
    const variable = match[1]
    if (!variable || match.index === undefined || locallyOwned.has(variable)) continue
    matches.push({ index: match.index, variable })
  }

  return matches
}

function replaceMatches(text: string, locallyOwned = new Set<string>()): ReplacementResult {
  let replacements = 0
  const content = text.replace(OCCURRENCE_PATTERN, (match, variable: string) => {
    if (locallyOwned.has(variable)) return match

    const replacement = EXACT_REPLACEMENTS.get(variable)
    if (!replacement) return match

    replacements += 1
    return replacement
  })

  return { content, replacements }
}

export function findLegacyVarsInLine(line: string): string[] {
  if (isCommentLine(line)) return []

  return findMatches(line)
    .map(({ variable }) => variable)
    .filter((variable) => !isVariableDefinitionLine(line, variable))
}

function lineTextAt(content: string, line: number): string {
  return (content.split(/\r?\n/)[line - 1] ?? '').trim()
}

function findingForNode(content: string, filePath: string, node: ChildNode, variable: string): Finding {
  const line = node.source?.start?.line ?? 1
  return { file: filePath, line, variable, lineText: lineTextAt(content, line) }
}

function collectCssLocallyOwnedVariables(root: Root): Set<string> {
  const locallyOwned = new Set<string>()

  root.walkDecls((declaration) => {
    if (LEGACY_VAR_SET.has(declaration.prop)) locallyOwned.add(declaration.prop)
  })

  return locallyOwned
}

function findCssLegacyVarHits(content: string, filePath: string): Finding[] {
  const root = postcss.parse(content, { from: filePath })
  const locallyOwned = collectCssLocallyOwnedVariables(root)
  const findings: Finding[] = []
  const collect = (text: string, node: ChildNode): void => {
    for (const { variable } of findMatches(text, locallyOwned)) {
      findings.push(findingForNode(content, filePath, node, variable))
    }
  }

  root.walkDecls((declaration) => {
    if (!LEGACY_VAR_SET.has(declaration.prop)) collect(declaration.value, declaration)
  })
  root.walkAtRules((atRule) => collect(atRule.params, atRule))
  root.walkRules((rule) => collect(rule.selector, rule))

  return findings
}

function replaceCssLegacyVars(content: string, filePath: string): ReplacementResult {
  const root = postcss.parse(content, { from: filePath })
  const locallyOwned = collectCssLocallyOwnedVariables(root)
  let replacements = 0
  const replace = (text: string): string => {
    const result = replaceMatches(text, locallyOwned)
    replacements += result.replacements
    return result.content
  }

  root.walkDecls((declaration: Declaration) => {
    if (!LEGACY_VAR_SET.has(declaration.prop)) declaration.value = replace(declaration.value)
  })
  root.walkAtRules((atRule: AtRule) => {
    atRule.params = replace(atRule.params)
  })
  root.walkRules((rule: Rule) => {
    rule.selector = replace(rule.selector)
  })

  return { content: root.toString(), replacements }
}

function scriptKindFor(filePath: string): ts.ScriptKind {
  return filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
}

function collectTypeScriptTextRanges(sourceFile: ts.SourceFile): TextRange[] {
  const ranges: TextRange[] = []
  const addRange = (node: ts.Node): void => {
    ranges.push({ start: node.getStart(sourceFile), end: node.getEnd() })
  }

  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node)) {
      addRange(node)
      return
    }

    if (ts.isTemplateExpression(node)) {
      addRange(node.head)
      for (const span of node.templateSpans) {
        visit(span.expression)
        addRange(span.literal)
      }
      return
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return ranges
}

function collectEmbeddedCssDefinitions(content: string): Set<string> {
  const locallyOwned = new Set<string>()
  const definitionPattern = new RegExp(`(?:^|[;{\\s])(${LEGACY_VARS.map(escapeRegExp).join('|')})\\s*:`, 'gm')

  for (const match of content.matchAll(definitionPattern)) {
    if (match[1]) locallyOwned.add(match[1])
  }

  return locallyOwned
}

function findTypeScriptLegacyVarHits(content: string, filePath: string): Finding[] {
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, scriptKindFor(filePath))
  const locallyOwned = collectEmbeddedCssDefinitions(content)
  const findings: Finding[] = []

  for (const range of collectTypeScriptTextRanges(sourceFile)) {
    const text = content.slice(range.start, range.end)
    for (const match of findMatches(text, locallyOwned)) {
      const line = sourceFile.getLineAndCharacterOfPosition(range.start + match.index).line + 1
      findings.push({
        file: filePath,
        line,
        variable: match.variable,
        lineText: lineTextAt(content, line)
      })
    }
  }

  return findings
}

function replaceTypeScriptLegacyVars(content: string, filePath: string): ReplacementResult {
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, scriptKindFor(filePath))
  const locallyOwned = collectEmbeddedCssDefinitions(content)
  const edits: Array<TextRange & { content: string; replacements: number }> = []

  for (const range of collectTypeScriptTextRanges(sourceFile)) {
    const result = replaceMatches(content.slice(range.start, range.end), locallyOwned)
    if (result.replacements > 0) edits.push({ ...range, content: result.content, replacements: result.replacements })
  }

  let nextContent = content
  let replacements = 0
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    nextContent = `${nextContent.slice(0, edit.start)}${edit.content}${nextContent.slice(edit.end)}`
    replacements += edit.replacements
  }

  return { content: nextContent, replacements }
}

export function findLegacyVarHitsInContent(content: string, filePath: string): Finding[] {
  return path.extname(filePath) === '.css'
    ? findCssLegacyVarHits(content, filePath)
    : findTypeScriptLegacyVarHits(content, filePath)
}

export function fixLegacyVarsInContent(content: string, filePath = 'source.tsx'): ReplacementResult {
  return path.extname(filePath) === '.css'
    ? replaceCssLegacyVars(content, filePath)
    : replaceTypeScriptLegacyVars(content, filePath)
}

function findLegacyVarHits(filePath: string): Finding[] {
  return findLegacyVarHitsInContent(fs.readFileSync(filePath, 'utf8'), filePath)
}

function fixLegacyVarHits(filePath: string): number {
  const content = fs.readFileSync(filePath, 'utf8')
  const result = fixLegacyVarsInContent(content, filePath)
  if (result.replacements > 0) fs.writeFileSync(filePath, result.content)
  return result.replacements
}

function toRepoRelative(filePath: string): string {
  return path.relative(REPO_ROOT, filePath)
}

function printResults(findings: Finding[], stdout: WritableStream, stderr: WritableStream): void {
  if (findings.length === 0) {
    stdout.write('No legacy CSS variable usages found.\n')
    return
  }

  const byVariable = new Map<string, number>()

  for (const finding of findings) {
    byVariable.set(finding.variable, (byVariable.get(finding.variable) ?? 0) + 1)
  }

  stderr.write('Legacy CSS variable usages detected:\n\n')

  for (const finding of findings) {
    stderr.write(`  ${toRepoRelative(finding.file)}:${finding.line}\n`)
    stderr.write(`    ${finding.variable}\n`)
    stderr.write(`    ${finding.lineText}\n`)
  }

  stderr.write('\nUsage summary:\n')

  for (const [variable, count] of [...byVariable.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    stderr.write(`  ${variable}: ${count}\n`)
  }

  stderr.write(
    '\nPrefer @cherrystudio/ui theme contract variables and Tailwind semantic utilities instead of adding new legacy var usages.\n'
  )
}

function printUsage(stderr: WritableStream): void {
  stderr.write('Usage: pnpm styles:legacy-vars [path] [--strict] [--fix]\n')
}

function printFixSummary(summary: FixSummary, stdout: WritableStream): void {
  stdout.write(
    `Legacy CSS variable exact migration: changed ${summary.filesChanged} files, replaced ${summary.replacements} usages.\n`
  )
}

export function runCli(argv = process.argv.slice(2), options: RunCliOptions = {}): number {
  const stdout = options.stdout ?? process.stdout
  const stderr = options.stderr ?? process.stderr
  const env = options.env ?? process.env
  const strict = argv.includes('--strict') || env.LEGACY_CSS_VARS_STRICT === 'true'
  const fix = argv.includes('--fix')
  const pathArgs = argv.filter((arg) => arg !== '--strict' && arg !== '--fix')

  if (pathArgs.length > 1) {
    printUsage(stderr)
    return 1
  }

  const targetInput = pathArgs[0]
  const targetPath = targetInput ? path.resolve(REPO_ROOT, targetInput) : REPO_ROOT

  if (!fs.existsSync(targetPath)) {
    stderr.write(`Path does not exist: ${targetInput}\n`)
    return 1
  }

  const files = collectTargetFiles(targetPath)

  if (fix) {
    const fixSummary: FixSummary = { filesChanged: 0, replacements: 0 }

    for (const file of files) {
      const replacements = fixLegacyVarHits(file)
      if (replacements === 0) continue
      fixSummary.filesChanged += 1
      fixSummary.replacements += replacements
    }

    printFixSummary(fixSummary, stdout)
  }

  const findings = files.flatMap(findLegacyVarHits)
  printResults(findings, stdout, stderr)

  return strict && findings.length > 0 ? 1 : 0
}

if (require.main === module) {
  process.exitCode = runCli()
}
