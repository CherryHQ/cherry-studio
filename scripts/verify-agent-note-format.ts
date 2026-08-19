/** Enforce lifecycle-specific Agent Note paths, headers, and sections. */
import * as fs from 'fs'
import * as path from 'path'

const ROOT = path.resolve(__dirname, '..')
const CLASSES = new Set(['feature', 'bug-fix', 'simplification', 'architecture', 'process', 'testing'])
const LIFECYCLES = new Set(['proposed', 'implemented', 'rejected'])
const NOTE_NAME = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/

const headingsOutsideFences = (lines: string[]): string[] => {
  let fenced = false
  const headings: string[] = []
  for (const line of lines) {
    if (line.startsWith('```')) {
      fenced = !fenced
      continue
    }
    if (!fenced && line.startsWith('## ')) headings.push(line.trimEnd())
  }
  return headings
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
  if (!/^# Agent Note: \S/u.test(lines[0] ?? '')) errors.push('line 1 must be `# Agent Note: <title>`')
  if (lines[1] !== '') errors.push('line 2 must be blank')
  const expectedStatus =
    lifecycle === 'rejected' ? /^Status: rejected — \S/u : new RegExp(`^Status: ${lifecycle}$`, 'u')
  if (!expectedStatus.test(lines[2] ?? '')) errors.push(`line 3 must match the ${lifecycle} status`)
  if (lines[3] !== '') errors.push('line 4 must be blank')

  const headings = headingsOutsideFences(lines)
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
    const acceptanceStart = lines.indexOf('## Acceptance criteria')
    const nextHeading = lines.findIndex((line, index) => index > acceptanceStart && line.startsWith('## '))
    const acceptanceLines = lines.slice(acceptanceStart + 1, nextHeading === -1 ? undefined : nextHeading)
    const criteria = acceptanceLines.filter((line) => /^- AC\d+ — \S.*\(verification: [^)]+\)$/u.test(line))
    if (criteria.length === 0) errors.push('Acceptance criteria must contain `- AC1 — <observable outcome>` entries')
    const numbers = criteria.map((line) => Number(/^- AC(\d+)/u.exec(line)?.[1]))
    if (numbers.some((number, index) => number !== index + 1))
      errors.push('Acceptance criteria IDs must be contiguous from AC1')
  }
  if (lifecycle === 'implemented') {
    const verificationStart = lines.indexOf('## Verification')
    const verificationLines = lines.slice(verificationStart + 1)
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
