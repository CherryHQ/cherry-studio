import * as fs from 'fs'
import * as path from 'path'

const RENDERER_DIR = path.join(__dirname, '../src/renderer/src')
const CHECK_EXTENSIONS = new Set(['.css', '.ts', '.tsx'])
const IGNORED_DIR_NAMES = new Set(['node_modules', 'dist', 'out'])
const IGNORED_FILE_PATTERNS = [/\.test\.(ts|tsx)$/, /\.spec\.(ts|tsx)$/, /\.snap$/]
const IGNORED_FILES = new Set([
  path.join(RENDERER_DIR, 'assets/styles/tailwind.css'),
  path.join(RENDERER_DIR, 'assets/styles/color.css'),
  path.join(RENDERER_DIR, 'assets/styles/legacy-vars.css')
])

export const LEGACY_VARS = [
  '--color-text-1',
  '--color-text-2',
  '--color-text-3',
  '--color-text',
  '--color-text-secondary',
  '--color-text-soft',
  '--color-text-light',
  '--color-background-soft',
  '--color-background-mute',
  '--color-background-opacity',
  '--color-border-soft',
  '--color-border-mute',
  '--color-error',
  '--color-link',
  '--color-primary-bg',
  '--color-fill-secondary',
  '--color-fill-2',
  '--color-bg-base',
  '--color-bg-1',
  '--color-code-background',
  '--color-inline-code-background',
  '--color-inline-code-text',
  '--color-hover',
  '--color-active',
  '--color-frame-border',
  '--color-group-background',
  '--color-reference',
  '--color-reference-text',
  '--color-reference-background',
  '--color-list-item',
  '--color-list-item-hover',
  '--color-highlight',
  '--color-background-highlight',
  '--color-background-highlight-accent',
  '--navbar-background-mac',
  '--navbar-background',
  '--modal-background',
  '--chat-background',
  '--chat-background-user',
  '--chat-background-assistant',
  '--chat-text-user',
  '--list-item-border-radius',
  '--color-gray-1',
  '--color-gray-2',
  '--color-gray-3',
  '--color-icon-white',
  '--color-primary-1',
  '--color-primary-6',
  '--color-status-success',
  '--color-status-error',
  '--color-status-warning'
] as const

const LEGACY_VAR_SET = new Set(LEGACY_VARS)
const OCCURRENCE_PATTERN = new RegExp(`(${LEGACY_VARS.map(escapeRegExp).join('|')})(?![\\w-])`, 'g')
const STRICT = process.argv.includes('--strict') || process.env.LEGACY_CSS_VARS_STRICT === 'true'

export interface Finding {
  file: string
  line: number
  variable: string
  lineText: string
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function shouldIgnoreFile(filePath: string): boolean {
  if (IGNORED_FILES.has(filePath)) return true
  const fileName = path.basename(filePath)
  return IGNORED_FILE_PATTERNS.some((pattern) => pattern.test(fileName))
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

function isVariableDefinitionLine(line: string, variable: string): boolean {
  return new RegExp(`^\\s*${escapeRegExp(variable)}\\s*:`).test(line)
}

export function isCommentLine(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('*/')
}

export function findLegacyVarsInLine(line: string): string[] {
  if (isCommentLine(line)) return []

  const matches = line.matchAll(OCCURRENCE_PATTERN)
  const variables: string[] = []

  for (const match of matches) {
    const variable = match[1]
    if (!variable || !LEGACY_VAR_SET.has(variable as (typeof LEGACY_VARS)[number])) continue
    if (isVariableDefinitionLine(line, variable)) continue
    variables.push(variable)
  }

  return variables
}

export function findLegacyVarHitsInContent(content: string, filePath: string): Finding[] {
  const lines = content.split(/\r?\n/)
  const findings: Finding[] = []

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    for (const variable of findLegacyVarsInLine(line)) {
      findings.push({
        file: filePath,
        line: index + 1,
        variable,
        lineText: line.trim()
      })
    }
  }

  return findings
}

function findLegacyVarHits(filePath: string): Finding[] {
  const content = fs.readFileSync(filePath, 'utf8')
  return findLegacyVarHitsInContent(content, filePath)
}

function toRepoRelative(filePath: string): string {
  return path.relative(path.join(__dirname, '..'), filePath)
}

function printResults(findings: Finding[]): void {
  if (findings.length === 0) {
    console.log('No legacy renderer CSS variable usages found.')
    return
  }

  const byVariable = new Map<string, number>()

  for (const finding of findings) {
    byVariable.set(finding.variable, (byVariable.get(finding.variable) ?? 0) + 1)
  }

  console.warn('Legacy renderer CSS variable usages detected:')
  console.warn('')

  for (const finding of findings) {
    console.warn(`  ${toRepoRelative(finding.file)}:${finding.line}`)
    console.warn(`    ${finding.variable}`)
    console.warn(`    ${finding.lineText}`)
  }

  console.warn('')
  console.warn('Usage summary:')

  for (const [variable, count] of [...byVariable.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.warn(`  ${variable}: ${count}`)
  }

  console.warn('')
  console.warn(
    'Prefer @cherrystudio/ui theme contract variables and Tailwind semantic utilities instead of adding new legacy var usages.'
  )
}

function main(): void {
  const files = collectFiles(RENDERER_DIR)
  const findings = files.flatMap(findLegacyVarHits)

  printResults(findings)

  if (STRICT && findings.length > 0) {
    process.exitCode = 1
  }
}

if (require.main === module) {
  main()
}
