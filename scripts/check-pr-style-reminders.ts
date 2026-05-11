import { execFileSync } from 'node:child_process'

import * as fs from 'fs'
import * as path from 'path'

import { findLegacyVarsInLine, shouldIgnoreFile } from './check-legacy-css-vars'
import {
  findTailwindCanonicalClassFindingsInContent,
  loadTailwindDesignSystem,
  type TailwindCanonicalClassFinding
} from './fix-tailwind-canonical-classes'

const REPO_ROOT = path.join(__dirname, '..')
const LEGACY_CHECK_EXTENSIONS = new Set(['.css', '.ts', '.tsx'])
const CANONICAL_CLASS_CHECK_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const STYLE_REMINDERS_COMMENT_MARKER = '<!-- style-reminders-warning -->'

export interface PullRequestLegacyFinding {
  file: string
  line: number
  variable: string
  lineText: string
}

export interface PullRequestTailwindCanonicalFinding extends TailwindCanonicalClassFinding {
  file: string
}

export interface CheckPullRequestStyleRemindersOptions {
  baseRef: string
  headRef: string
}

interface HunkRange {
  newStart: number
}

function runGit(args: string[]): string {
  return execFileSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8'
  })
}

function parseArgs(): { baseRef: string; headRef: string; markdownOutput?: string } {
  const args = process.argv.slice(2)
  let baseRef = process.env.BASE_SHA ?? process.env.GITHUB_BASE_REF ?? ''
  let headRef = process.env.HEAD_SHA ?? process.env.GITHUB_SHA ?? 'HEAD'
  let markdownOutput = process.env.STYLE_REMINDERS_PR_MARKDOWN_OUTPUT

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--base' && args[index + 1]) {
      baseRef = args[++index]
      continue
    }
    if (arg === '--head' && args[index + 1]) {
      headRef = args[++index]
      continue
    }
    if (arg === '--markdown-output' && args[index + 1]) {
      markdownOutput = args[++index]
    }
  }

  if (!baseRef) {
    throw new Error('Missing base ref. Pass --base <sha> or set BASE_SHA.')
  }

  return { baseRef, headRef, markdownOutput }
}

function isTrackedRendererFile(filePath: string): boolean {
  if (!filePath.startsWith('src/renderer/src/')) return false
  if (!LEGACY_CHECK_EXTENSIONS.has(path.extname(filePath))) return false
  return !shouldIgnoreFile(path.join(REPO_ROOT, filePath))
}

function isCanonicalClassCheckFile(filePath: string): boolean {
  if (!filePath.startsWith('src/renderer/src/')) return false
  if (!CANONICAL_CLASS_CHECK_EXTENSIONS.has(path.extname(filePath))) return false
  return !shouldIgnoreFile(path.join(REPO_ROOT, filePath))
}

function getChangedRendererFiles(baseRef: string, headRef: string): string[] {
  const output = runGit(['diff', '--name-only', '--diff-filter=ACMR', baseRef, headRef, '--', 'src/renderer/src'])

  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(isTrackedRendererFile)
}

function getChangedCanonicalClassFiles(baseRef: string, headRef: string): string[] {
  const output = runGit(['diff', '--name-only', '--diff-filter=ACMR', baseRef, headRef, '--', 'src/renderer/src'])

  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(isCanonicalClassCheckFile)
}

export function parseAddedLineNumbersFromDiff(diff: string): Set<number> {
  const lines = diff.split(/\r?\n/)
  const addedLineNumbers = new Set<number>()
  let newLineNumber = 0
  let inHunk = false

  for (const line of lines) {
    if (line.startsWith('@@')) {
      const hunk = parseHunkRange(line)
      if (!hunk) continue
      newLineNumber = hunk.newStart
      inHunk = true
      continue
    }

    if (
      !inHunk ||
      line.startsWith('diff --git') ||
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ')
    ) {
      continue
    }

    if (line.startsWith('+')) {
      addedLineNumbers.add(newLineNumber)
      newLineNumber += 1
      continue
    }

    if (line.startsWith('-')) {
      continue
    }

    newLineNumber += 1
  }

  return addedLineNumbers
}

function parseHunkRange(line: string): HunkRange | null {
  const match = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
  if (!match) return null

  return {
    newStart: Number(match[1])
  }
}

export function parseAddedLegacyVarFindingsFromDiff(diff: string, filePath: string): PullRequestLegacyFinding[] {
  const lines = diff.split(/\r?\n/)
  const findings: PullRequestLegacyFinding[] = []
  let newLineNumber = 0
  let inHunk = false

  for (const line of lines) {
    if (line.startsWith('@@')) {
      const hunk = parseHunkRange(line)
      if (!hunk) continue
      newLineNumber = hunk.newStart
      inHunk = true
      continue
    }

    if (
      !inHunk ||
      line.startsWith('diff --git') ||
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ')
    ) {
      continue
    }

    if (line.startsWith('+')) {
      const addedLine = line.slice(1)
      for (const variable of findLegacyVarsInLine(addedLine)) {
        findings.push({
          file: filePath,
          line: newLineNumber,
          variable,
          lineText: addedLine.trim()
        })
      }
      newLineNumber += 1
      continue
    }

    if (line.startsWith('-')) {
      continue
    }

    newLineNumber += 1
  }

  return findings
}

export function checkPullRequestLegacyVars({
  baseRef,
  headRef
}: CheckPullRequestStyleRemindersOptions): PullRequestLegacyFinding[] {
  const files = getChangedRendererFiles(baseRef, headRef)

  return files.flatMap((filePath) => {
    const diff = runGit(['diff', '--unified=0', '--no-color', baseRef, headRef, '--', filePath])
    return parseAddedLegacyVarFindingsFromDiff(diff, filePath)
  })
}

export async function checkPullRequestTailwindCanonicalClasses({
  baseRef,
  headRef
}: CheckPullRequestStyleRemindersOptions): Promise<PullRequestTailwindCanonicalFinding[]> {
  const files = getChangedCanonicalClassFiles(baseRef, headRef)
  if (files.length === 0) return []

  const designSystem = await loadTailwindDesignSystem(REPO_ROOT)

  return files.flatMap((filePath) => {
    const diff = runGit(['diff', '--unified=0', '--no-color', baseRef, headRef, '--', filePath])
    const addedLineNumbers = parseAddedLineNumbersFromDiff(diff)
    if (addedLineNumbers.size === 0) return []

    const content = fs.readFileSync(path.join(REPO_ROOT, filePath), 'utf8')
    return findTailwindCanonicalClassFindingsInContent(content, filePath, designSystem)
      .filter((finding) => addedLineNumbers.has(finding.line))
      .map((finding) => ({
        ...finding,
        file: filePath
      }))
  })
}

export function buildPullRequestStyleRemindersComment(
  findings: PullRequestLegacyFinding[],
  canonicalClassFindings: PullRequestTailwindCanonicalFinding[] = []
): string {
  if (findings.length === 0 && canonicalClassFindings.length === 0) {
    return ''
  }

  return [
    STYLE_REMINDERS_COMMENT_MARKER,
    '## Style Reminders',
    '',
    buildLegacyVarsCommentSection(findings),
    buildCanonicalClassesCommentSection(canonicalClassFindings),
    '',
    'This is a migration reminder only and does not block the PR.'
  ]
    .filter(Boolean)
    .join('\n')
}

function buildLegacyVarsCommentSection(findings: PullRequestLegacyFinding[]): string {
  if (findings.length === 0) return ''

  const uniqueFiles = new Set(findings.map((finding) => finding.file)).size
  const summary = new Map<string, number>()

  for (const finding of findings) {
    summary.set(finding.variable, (summary.get(finding.variable) ?? 0) + 1)
  }

  const summaryLines = [...summary.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([variable, count]) => `- \`${variable}\`: ${count}`)

  const sampleFindings = findings.slice(0, 20).map((finding) => {
    return `- \`${finding.file}:${finding.line}\` uses \`${finding.variable}\`\n  \`${finding.lineText}\``
  })

  const overflowLine =
    findings.length > sampleFindings.length
      ? `\nThere are ${findings.length - sampleFindings.length} more matches in this PR.`
      : ''

  return [
    '### Legacy CSS Variables Detected',
    '',
    `This PR adds new usages of deprecated renderer legacy CSS variables in ${uniqueFiles} file(s).`,
    'Please migrate these changes to `@cherrystudio/ui` theme contract variables or Tailwind semantic utilities when possible.',
    '',
    '**Usage summary**',
    ...summaryLines,
    '',
    '**New usages introduced by this PR**',
    ...sampleFindings,
    overflowLine
  ]
    .filter(Boolean)
    .join('\n')
}

function buildCanonicalClassesCommentSection(findings: PullRequestTailwindCanonicalFinding[]): string {
  if (findings.length === 0) return ''

  const uniqueFiles = new Set(findings.map((finding) => finding.file)).size
  const sampleFindings = findings.slice(0, 20).map((finding) => {
    return `- \`${finding.file}:${finding.line}\` can use \`${finding.canonical}\` instead of \`${finding.original}\`\n  \`${finding.lineText}\``
  })

  const overflowLine =
    findings.length > sampleFindings.length
      ? `\nThere are ${findings.length - sampleFindings.length} more Tailwind class matches in this PR.`
      : ''

  return [
    '### Tailwind Canonical Classes Detected',
    '',
    `This PR adds Tailwind classes with shorter canonical forms in ${uniqueFiles} file(s).`,
    'Run `pnpm styles:canonical <path>` locally to rewrite them automatically.',
    '',
    '**New canonical class suggestions introduced by this PR**',
    ...sampleFindings,
    overflowLine
  ]
    .filter(Boolean)
    .join('\n')
}

function writeMarkdownOutput(markdownOutput: string | undefined, body: string): void {
  if (!markdownOutput) return
  const outputPath = path.resolve(REPO_ROOT, markdownOutput)
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, body, 'utf8')
}

async function main(): Promise<void> {
  const { baseRef, headRef, markdownOutput } = parseArgs()
  const findings = checkPullRequestLegacyVars({ baseRef, headRef })
  const canonicalClassFindings = await checkPullRequestTailwindCanonicalClasses({ baseRef, headRef })
  const body = buildPullRequestStyleRemindersComment(findings, canonicalClassFindings)

  if (findings.length === 0 && canonicalClassFindings.length === 0) {
    console.log(
      'No new legacy renderer CSS variable usages or Tailwind canonical class suggestions were introduced in this PR.'
    )
  } else {
    console.warn(
      `Detected ${findings.length} new legacy renderer CSS variable usage(s) and ${canonicalClassFindings.length} Tailwind canonical class suggestion(s) in this PR.`
    )
    console.warn('')
    console.warn(body)
  }

  writeMarkdownOutput(markdownOutput, body)
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
