import * as fs from 'fs'
import * as path from 'path'

const REPO_ROOT = path.join(__dirname, '..')
const RENDERER_DIR = path.join(REPO_ROOT, 'src/renderer/src')
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
const AUTO_FIX_REPLACEMENTS: Partial<Record<(typeof LEGACY_VARS)[number], string>> = {
  '--color-text-1': '--color-foreground',
  '--color-text-2': '--color-foreground-secondary',
  '--color-text-3': '--color-foreground-muted',
  '--color-text': '--color-foreground',
  '--color-text-secondary': '--color-foreground-secondary',
  '--color-text-soft': '--color-foreground-secondary',
  '--color-text-light': '--color-foreground',
  '--color-background-soft': '--color-muted',
  '--color-background-mute': '--color-accent',
  '--color-background-opacity': '--color-background',
  '--color-border-soft': '--color-border',
  '--color-border-mute': '--color-border',
  '--color-error': '--color-error-base',
  '--color-link': '--color-primary',
  '--color-primary-bg': '--color-primary-soft',
  '--color-fill-secondary': '--color-muted',
  '--color-fill-2': '--color-muted',
  '--color-bg-base': '--color-background',
  '--color-bg-1': '--color-muted',
  '--color-hover': '--color-accent',
  '--color-active': '--color-muted',
  '--color-frame-border': '--color-border',
  '--color-group-background': '--color-muted',
  '--color-reference': '--color-primary-soft',
  '--color-reference-text': '--color-primary',
  '--color-reference-background': '--color-primary-soft',
  '--color-list-item': '--color-background',
  '--color-list-item-hover': '--color-accent',
  '--navbar-background': '--color-background',
  '--modal-background': '--color-card',
  '--chat-background-user': '--color-muted',
  '--chat-text-user': '--color-foreground',
  '--list-item-border-radius': '--radius-lg',
  '--color-primary-1': '--color-primary-soft',
  '--color-primary-6': '--color-primary',
  '--color-status-success': '--color-success',
  '--color-status-error': '--color-error-base',
  '--color-status-warning': '--color-warning'
}

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

export function collectTargetFiles(targetPath = RENDERER_DIR): string[] {
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

export function fixLegacyVarsInContent(content: string): { content: string; replacements: number } {
  const lines = content.split(/\r?\n/)
  let replacements = 0

  const nextLines = lines.map((line) => {
    const variables = new Set(findLegacyVarsInLine(line))
    let nextLine = line

    for (const variable of variables) {
      const replacement = AUTO_FIX_REPLACEMENTS[variable as (typeof LEGACY_VARS)[number]]
      if (!replacement) continue

      const pattern = new RegExp(`${escapeRegExp(variable)}(?![\\w-])`, 'g')
      nextLine = nextLine.replace(pattern, () => {
        replacements += 1
        return replacement
      })
    }

    return nextLine
  })

  return { content: nextLines.join('\n'), replacements }
}

function findLegacyVarHits(filePath: string): Finding[] {
  const content = fs.readFileSync(filePath, 'utf8')
  return findLegacyVarHitsInContent(content, filePath)
}

function fixLegacyVarHits(filePath: string): number {
  const content = fs.readFileSync(filePath, 'utf8')
  const result = fixLegacyVarsInContent(content)
  if (result.replacements > 0) {
    fs.writeFileSync(filePath, result.content)
  }
  return result.replacements
}

function toRepoRelative(filePath: string): string {
  return path.relative(REPO_ROOT, filePath)
}

function printResults(findings: Finding[], stdout: WritableStream, stderr: WritableStream): void {
  if (findings.length === 0) {
    stdout.write('No legacy renderer CSS variable usages found.\n')
    return
  }

  const byVariable = new Map<string, number>()

  for (const finding of findings) {
    byVariable.set(finding.variable, (byVariable.get(finding.variable) ?? 0) + 1)
  }

  stderr.write('Legacy renderer CSS variable usages detected:\n')
  stderr.write('\n')

  for (const finding of findings) {
    stderr.write(`  ${toRepoRelative(finding.file)}:${finding.line}\n`)
    stderr.write(`    ${finding.variable}\n`)
    stderr.write(`    ${finding.lineText}\n`)
  }

  stderr.write('\n')
  stderr.write('Usage summary:\n')

  for (const [variable, count] of [...byVariable.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    stderr.write(`  ${variable}: ${count}\n`)
  }

  stderr.write('\n')
  stderr.write(
    'Prefer @cherrystudio/ui theme contract variables and Tailwind semantic utilities instead of adding new legacy var usages.\n'
  )
}

function printUsage(stderr: WritableStream): void {
  stderr.write('Usage: pnpm styles:legacy-vars [path] [--strict] [--fix]\n')
}

function printFixSummary(summary: FixSummary, stdout: WritableStream): void {
  stdout.write(
    `Legacy renderer CSS variable auto-fix: changed ${summary.filesChanged} files, replaced ${summary.replacements} usages.\n`
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
  const targetPath = targetInput ? path.resolve(REPO_ROOT, targetInput) : RENDERER_DIR

  if (!fs.existsSync(targetPath)) {
    stderr.write(`Path does not exist: ${targetInput}\n`)
    return 1
  }

  const files = collectTargetFiles(targetPath)

  if (fix) {
    const fixSummary: FixSummary = {
      filesChanged: 0,
      replacements: 0
    }

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
