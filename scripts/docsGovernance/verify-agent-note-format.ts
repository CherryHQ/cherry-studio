/** Enforce lifecycle-specific Agent Note paths, headers, and sections. */
import * as fs from 'fs'
import * as path from 'path'

import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'

const ROOT = path.resolve(__dirname, '../..')
const CLASSES = new Set(['feature', 'bug-fix', 'simplification', 'architecture', 'process', 'testing'])
const LIFECYCLES = new Set(['proposed', 'implemented', 'rejected'])
const NOTE_NAME = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/
const ACCEPTANCE_CRITERION = /^- (AC\d+) — \S.*\(verification: [^)]+\)$/u
const CRITERION_ENTRY = /^- (AC\d+)\b/u

export const parseAcceptanceCriteria = (lines: string[]): { ids: string[]; malformed: string[] } => {
  const ids: string[] = []
  const malformed: string[] = []
  for (const line of lines) {
    const entry = CRITERION_ENTRY.exec(line)?.[1]
    if (!entry) continue
    const criterion = ACCEPTANCE_CRITERION.exec(line)?.[1]
    if (criterion) ids.push(criterion)
    else malformed.push(entry)
  }
  return { ids, malformed }
}

export const linesOutsideCode = (content: string): string[] => {
  const visibleContent = content.split('')
  const tree = unified().use(remarkParse).parse(content)
  visit(tree, (node) => {
    if (node.type !== 'code' && (node.type !== 'html' || !node.value.trimStart().startsWith('<!--'))) return
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start === undefined || end === undefined) return
    for (let index = start; index < end; index += 1) {
      if (visibleContent[index] !== '\n' && visibleContent[index] !== '\r') visibleContent[index] = ' '
    }
  })
  return visibleContent.join('').split('\n')
}

export const checkAgentNote = (relative: string, content: string): string[] => {
  const errors: string[] = []
  const parts = relative.split('/')
  const [lifecycle, noteClass, filename] = parts.slice(-3)
  if (!lifecycle || !LIFECYCLES.has(lifecycle))
    errors.push('path must use proposed, implemented, or rejected lifecycle')
  if (!noteClass || !CLASSES.has(noteClass)) errors.push('path must use a supported Agent Note class')
  if (!filename || !NOTE_NAME.test(filename)) errors.push('filename must be yyyy-mm-dd-kebab-topic.md')

  const lines = content.split('\n')
  const structuralLines = linesOutsideCode(content)
  if (!/^# Agent Note: \S/u.test(lines[0] ?? '')) errors.push('line 1 must be `# Agent Note: <title>`')
  if (lines[1] !== '') errors.push('line 2 must be blank')
  const expectedStatus =
    lifecycle === 'rejected' ? /^Status: rejected — \S/u : new RegExp(`^Status: ${lifecycle}$`, 'u')
  if (!expectedStatus.test(lines[2] ?? '')) errors.push(`line 3 must match the ${lifecycle} status`)
  if (lines[3] !== '') errors.push('line 4 must be blank')

  const headings = structuralLines.filter((line) => line.startsWith('## ')).map((line) => line.trimEnd())
  if (headings[0] !== '## Problem') errors.push('the first section must be `## Problem`')
  const required: Record<string, string[]> = {
    proposed: ['## Proposal', '## Alternatives considered', '## Acceptance criteria', '## Risks'],
    implemented: ['## Decision', '## Alternatives considered', '## Consequences', '## Verification'],
    rejected: ['## Proposal', '## Rejection rationale', '## Alternatives considered']
  }
  for (const heading of required[lifecycle] ?? []) {
    if (!headings.includes(heading)) errors.push(`missing required section ${heading}`)
  }
  if (lifecycle === 'implemented') {
    for (const heading of headings.filter((value) => /^## (?:Proposal|Acceptance criteria|Risks)$/u.test(value))) {
      errors.push(`${heading} is proposal language and is not allowed in implemented notes`)
    }
  }
  if (lifecycle === 'proposed') {
    const acceptanceStart = structuralLines.indexOf('## Acceptance criteria')
    const nextHeading = structuralLines.findIndex((line, index) => index > acceptanceStart && line.startsWith('## '))
    const acceptanceLines = structuralLines.slice(acceptanceStart + 1, nextHeading === -1 ? undefined : nextHeading)
    const criteria = parseAcceptanceCriteria(acceptanceLines)
    if (criteria.ids.length === 0)
      errors.push('Acceptance criteria must contain `- AC1 — <observable outcome>` entries')
    if (criteria.malformed.length)
      errors.push('Acceptance criteria entries must match `- AC1 — <observable outcome> (verification: <owner>)`')
    const numbers = criteria.ids.map((id) => Number(/^AC(\d+)$/u.exec(id)?.[1]))
    if (numbers.some((number, index) => number !== index + 1))
      errors.push('Acceptance criteria IDs must be contiguous from AC1')
  }
  if (lifecycle === 'implemented') {
    const verificationStart = structuralLines.indexOf('## Verification')
    const verificationLines = structuralLines.slice(verificationStart + 1)
    if (!verificationLines.some((line) => /^- (?:AC\d+|Regression) — \S/u.test(line))) {
      errors.push('Verification must map AC IDs or a direct bug regression to actual evidence')
    }
  }
  return errors
}

export const checkAgentNotes = (repoRoot: string): string[] => {
  const notesRoot = path.join(repoRoot, '.agents/notes')
  const errors: string[] = []
  for (const entry of fs.readdirSync(notesRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && !LIFECYCLES.has(entry.name))
      errors.push(`.agents/notes/${entry.name}/: unsupported lifecycle`)
  }
  for (const lifecycle of [...LIFECYCLES].sort()) {
    const lifecycleDir = path.join(notesRoot, lifecycle)
    if (!fs.existsSync(lifecycleDir)) continue
    for (const noteClass of fs.readdirSync(lifecycleDir)) {
      if (noteClass === 'AGENTS.md') continue
      const classDir = path.join(lifecycleDir, noteClass)
      if (!fs.statSync(classDir).isDirectory()) {
        errors.push(`${path.relative(repoRoot, classDir)}: lifecycle entries must be class directories`)
        continue
      }
      if (!CLASSES.has(noteClass)) errors.push(`${path.relative(repoRoot, classDir)}: unsupported Agent Note class`)
      for (const filename of fs.readdirSync(classDir)) {
        if (!filename.endsWith('.md') || filename.endsWith('.zh.md') || filename === 'AGENTS.md') continue
        const file = path.join(classDir, filename)
        const relative = path.relative(repoRoot, file).split(path.sep).join('/')
        for (const error of checkAgentNote(relative, fs.readFileSync(file, 'utf8')))
          errors.push(`${relative}: ${error}`)
      }
    }
  }
  return errors
}

const main = (): void => {
  const errors = checkAgentNotes(ROOT)
  if (errors.length) {
    console.error('Agent Note format violations:')
    for (const error of errors) console.error(`  ${error}`)
    process.exitCode = 1
    return
  }
  console.log('Agent Note format OK.')
}

if (require.main === module) main()
