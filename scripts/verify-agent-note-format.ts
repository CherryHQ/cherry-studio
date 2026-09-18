/** Enforces the Agent Note format: lifecycle and class placement, the dated filename, the header block, and the sections each lifecycle owes. */
import * as fs from 'fs'
import * as path from 'path'

const ROOT = path.resolve(__dirname, '..')

/** The closed set of note classes. Adding one is deliberate: extend this list in the same PR that creates the directory. */
export const NOTE_CLASSES: readonly string[] = [
  'architecture',
  'bug-fix',
  'feature',
  'process',
  'simplification',
  'testing'
]

/** The sections every note owes whatever its lifecycle. */
export const COMMON_SECTIONS: readonly string[] = ['Problem', 'Alternatives considered']

/** The sections a lifecycle owes on top of the common ones, and the section that closes the note. */
interface LifecycleSections {
  readonly required: readonly string[]
  readonly closing: string | null
}

/**
 * The closed set of note lifecycles, each with the sections it owes. This table is the single source of truth for
 * which lifecycles exist: a note changes lifecycle by moving its file, never by editing its `Status:` line alone.
 */
export const LIFECYCLE_SECTIONS: Record<string, LifecycleSections> = {
  proposed: { required: ['Proposal', 'Acceptance criteria', 'Risks'], closing: 'Risks' },
  implemented: { required: ['Decision', 'Consequences'], closing: 'Consequences' },
  rejected: { required: [], closing: null }
}

/** Derived from LIFECYCLE_SECTIONS so a lifecycle can never be known to the placement check and unknown to the section check. */
export const NOTE_LIFECYCLES: readonly string[] = Object.keys(LIFECYCLE_SECTIONS)

/** `<yyyy-mm-dd>-<topic>.md`, with an optional language suffix such as `.zh`. */
const NOTE_FILENAME_RE = /^\d{4}-\d{2}-\d{2}-[\w-]+(?:\.[a-z0-9-]+)?\.md$/

const isReadme = (filename: string): boolean => /^README(?:\.[a-z0-9-]+)?\.md$/i.test(filename)

/** A code fence: up to three leading spaces, then a run of at least three backticks or tildes, then the info string. */
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/

/**
 * Blanks out fenced code blocks, keeping one entry per input line so line numbers stay meaningful.
 * A note quotes Markdown constantly — the template, an example, another gate's output — and none of that is note structure.
 */
export const stripFencedCode = (lines: readonly string[]): string[] => {
  const stripped: string[] = []
  let fence: string | null = null
  for (const line of lines) {
    const match = FENCE_RE.exec(line)
    if (fence === null) {
      // A backtick fence closes at the end of its line; only a tilde fence may carry a tilde in its info string.
      if (match !== null && (match[1][0] === '~' || !match[2].includes('`'))) {
        fence = match[1]
        stripped.push('')
        continue
      }
      stripped.push(line)
      continue
    }
    if (match !== null && match[1][0] === fence[0] && match[1].length >= fence.length && match[2].trim() === '') {
      fence = null
    }
    stripped.push('')
  }
  return stripped
}

/** Every note under a notes directory, as slash-separated paths relative to it, sorted so the gate reports a stable order. */
export const listNoteFiles = (notesDir: string): string[] => {
  const found: string[] = []
  const walk = (dir: string, prefix: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), relative)
      } else if (entry.name.endsWith('.md') && !(prefix === '' && isReadme(entry.name))) {
        found.push(relative)
      }
    }
  }
  walk(notesDir, '')
  return found.sort()
}

export const checkNoteFormat = (notesDir: string): string[] => {
  const failures: string[] = []

  for (const relative of listNoteFiles(notesDir)) {
    const segments = relative.split('/')
    const basename = segments[segments.length - 1]
    const lines = stripFencedCode(fs.readFileSync(path.join(notesDir, relative), 'utf-8').split('\n'))

    // Placement: a note lives at {lifecycle}/{class}/yyyy-mm-dd-topic.md.
    if (segments.length !== 3) {
      failures.push(`${relative}: a note lives at {lifecycle}/{class}/yyyy-mm-dd-topic.md`)
      continue
    }

    const lifecycle = segments[0]
    const noteClass = segments[1]
    const knownLifecycle = NOTE_LIFECYCLES.includes(lifecycle)
    const knownClass = NOTE_CLASSES.includes(noteClass)

    if (!knownLifecycle) {
      failures.push(`${relative}: '${lifecycle}/' is not a lifecycle — use one of ${NOTE_LIFECYCLES.join(', ')}`)
    }
    if (!knownClass) {
      failures.push(`${relative}: '${noteClass}/' is not a class — use one of ${NOTE_CLASSES.join(', ')}`)
    }
    if (!NOTE_FILENAME_RE.test(basename)) {
      failures.push(`${relative}: the filename does not start with a yyyy-mm-dd date`)
    }

    // Header block: no frontmatter, an `# Agent Note:` title, then the status line.
    const firstContentIndex = lines.findIndex((line) => line.trim() !== '')
    if (firstContentIndex !== -1 && lines[firstContentIndex].trim() === '---') {
      failures.push(`${relative}: a note carries no frontmatter — its path and header block carry the metadata`)
    }
    if (firstContentIndex === -1 || !/^# Agent Note:\s*\S/.test(lines[firstContentIndex].trim())) {
      failures.push(`${relative}: missing the '# Agent Note: <title>' opening line`)
    }

    // Sections: `## ` headings only, so `### ` sub-sections of a bespoke section do not count as one.
    const headings: string[] = []
    let firstHeadingIndex = -1
    for (let index = 0; index < lines.length; index++) {
      if (/^##\s/.test(lines[index])) {
        if (firstHeadingIndex === -1) firstHeadingIndex = index
        headings.push(lines[index].replace(/^##\s+/, '').trim())
      }
    }

    let statusIndex = -1
    for (let index = 0; index < lines.length; index++) {
      if (/^Status:\s*\S/.test(lines[index])) {
        statusIndex = index
        break
      }
    }
    if (statusIndex === -1) {
      failures.push(`${relative}: missing the 'Status: <lifecycle>' line of the header block`)
    } else {
      const status = lines[statusIndex].replace(/^Status:\s*/, '').trim()
      if (knownLifecycle && status !== lifecycle) {
        failures.push(`${relative}: 'Status: ${status}' contradicts the '${lifecycle}/' directory`)
      }
      if (firstHeadingIndex !== -1 && statusIndex > firstHeadingIndex) {
        failures.push(`${relative}: 'Status:' belongs to the header block, above the first section`)
      }
    }

    if (headings.length === 0 || headings[0] !== 'Problem') {
      failures.push(`${relative}: the first section must be '## Problem'`)
    }
    for (const section of COMMON_SECTIONS) {
      if (!headings.includes(section)) {
        failures.push(`${relative}: missing the mandatory '## ${section}' section`)
      }
    }

    if (knownLifecycle) {
      const lifecycleSections = LIFECYCLE_SECTIONS[lifecycle]
      for (const section of lifecycleSections.required) {
        if (!headings.includes(section)) {
          failures.push(`${relative}: a ${lifecycle} note owes '## ${section}'`)
        }
      }
      const alternativesIndex = headings.indexOf('Alternatives considered')
      const closing = lifecycleSections.closing
      const closingIndex = closing === null ? -1 : headings.indexOf(closing)
      if (alternativesIndex !== -1 && closingIndex !== -1 && alternativesIndex > closingIndex) {
        failures.push(`${relative}: '## Alternatives considered' comes before '## ${closing}'`)
      }
    }
  }

  return failures
}

const main = () => {
  const notesDir = path.join(ROOT, '.agents/notes')
  const failures = checkNoteFormat(notesDir)
  if (failures.length > 0) {
    console.error(`Found ${failures.length} agent note format violation(s):\n`)
    for (const failure of failures) console.error(`  ${failure}`)
    process.exit(1)
  }
  console.log(`Agent note format OK (${listNoteFiles(notesDir).length} notes).`)
}

if (require.main === module) main()
