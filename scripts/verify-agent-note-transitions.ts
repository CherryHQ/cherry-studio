/** Validate Agent Note lifecycle transitions against an explicit Git base. */
import { execFileSync } from 'node:child_process'
import { parseArgs } from 'node:util'

import { collectChangeScope } from './change-scope.mjs'
import { linesOutsideCode } from './verify-agent-note-format'

const NOTE_PATH =
  /^\.agents\/notes\/(proposed|implemented|rejected)\/(feature|bug-fix|simplification|architecture|process|testing)\/(\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.md)$/u

type Lifecycle = 'proposed' | 'implemented' | 'rejected'

interface NoteLocation {
  lifecycle: Lifecycle
  noteClass: string
  filename: string
  path: string
}

export interface NoteTransition {
  identity: string
  from: NoteLocation
  to: NoteLocation
  acceptanceCriteria: string[]
  verification: string[]
}

export interface NoteTransitionReport {
  formatVersion: 1
  resolved: { baseSha: string; headSha: string; mergeBaseSha: string }
  transitions: NoteTransition[]
  errors: string[]
}

const noteLocation = (file: string): NoteLocation | undefined => {
  if (file.endsWith('.zh.md')) return undefined
  const match = NOTE_PATH.exec(file)
  if (!match?.[1] || !match[2] || !match[3]) return undefined
  return { lifecycle: match[1] as Lifecycle, noteClass: match[2], filename: match[3], path: file }
}

const noteIdentity = (note: NoteLocation): string => `${note.noteClass}/${note.filename}`

const sectionLines = (content: string, heading: string): string[] => {
  const lines = linesOutsideCode(content)
  const start = lines.indexOf(heading)
  if (start === -1) return []
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '))
  return lines.slice(start + 1, end === -1 ? undefined : end)
}

const criterionIds = (content: string, heading: string): string[] =>
  sectionLines(content, heading)
    .map((line) => /^- (AC\d+) — \S/u.exec(line)?.[1])
    .filter((value): value is string => Boolean(value))

const repeatedIds = (ids: string[]): string[] => [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))]

export const checkAgentNoteTransition = (
  fromPath: string,
  before: string,
  toPath: string,
  after: string
): { transition?: NoteTransition; errors: string[] } => {
  const from = noteLocation(fromPath)
  const to = noteLocation(toPath)
  if (!from || !to) return { errors: ['transition paths must identify English Agent Notes'] }
  if (noteIdentity(from) !== noteIdentity(to))
    return { errors: ['a lifecycle transition must preserve class and filename'] }

  const acceptanceCriteria = criterionIds(before, '## Acceptance criteria')
  const verification = criterionIds(after, '## Verification')
  const transition = { identity: noteIdentity(from), from, to, acceptanceCriteria, verification }
  const errors: string[] = []

  if (from.lifecycle !== 'proposed' || !['implemented', 'rejected'].includes(to.lifecycle)) {
    errors.push(`unsupported lifecycle transition: ${from.lifecycle} → ${to.lifecycle}`)
  }
  if (to.lifecycle === 'implemented') {
    if (acceptanceCriteria.length === 0) errors.push('the proposed note has no acceptance-criteria IDs')
    const repeatedCriteria = repeatedIds(acceptanceCriteria)
    if (repeatedCriteria.length) errors.push(`the proposed note repeats criteria: ${repeatedCriteria.join(', ')}`)
    const missing = acceptanceCriteria.filter((id) => !verification.includes(id))
    if (missing.length) errors.push(`Verification is missing ${missing.join(', ')}`)
    const extra = verification.filter((id) => !acceptanceCriteria.includes(id))
    if (extra.length) errors.push(`Verification contains unknown criteria: ${extra.join(', ')}`)
    const repeatedVerification = repeatedIds(verification)
    if (repeatedVerification.length) errors.push(`Verification repeats criteria: ${repeatedVerification.join(', ')}`)
  }
  if (to.lifecycle === 'rejected' && !/^Status: rejected — \S/mu.test(after)) {
    errors.push('a rejected transition requires a one-line rejection reason')
  }
  return { transition, errors }
}

const git = (root: string, args: string[]): string =>
  execFileSync('git', ['-C', root, '-c', 'core.fsmonitor=false', ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LANG: 'C', LC_ALL: 'C' },
    maxBuffer: 64 * 1024 * 1024
  })

const treePaths = (root: string, ref: string): Set<string> =>
  new Set(git(root, ['ls-tree', '-r', '--name-only', '-z', ref, '--', '.agents/notes']).split('\0').filter(Boolean))

const noteMap = (paths: Set<string>): Map<string, NoteLocation> => {
  const notes = new Map<string, NoteLocation>()
  for (const file of paths) {
    const note = noteLocation(file)
    if (!note) continue
    const identity = noteIdentity(note)
    const existing = notes.get(identity)
    if (existing) throw new Error(`${identity} exists in both ${existing.lifecycle} and ${note.lifecycle}`)
    notes.set(identity, note)
  }
  return notes
}

const pairPaths = (file: string): string[] => {
  const stem = file.slice(0, -'.md'.length)
  return [file, `${stem}.zh.md`, `${stem}.i18n.yaml`]
}

export const collectAgentNoteTransitionReport = (
  { base, head = 'HEAD' }: { base: string; head?: string },
  cwd = process.cwd()
): NoteTransitionReport => {
  const scope = collectChangeScope({ base, head }, cwd)
  const root = scope.repositoryRoot
  const beforePaths = treePaths(root, scope.resolved.mergeBaseSha)
  const afterPaths = treePaths(root, scope.resolved.headSha)
  const beforeNotes = noteMap(beforePaths)
  const afterNotes = noteMap(afterPaths)
  const transitions: NoteTransition[] = []
  const errors: string[] = []

  for (const identity of [...beforeNotes.keys()].sort()) {
    const from = beforeNotes.get(identity)!
    const to = afterNotes.get(identity)
    if (!to) {
      if (from.lifecycle === 'proposed')
        errors.push(`${identity}: proposed note was removed without an implemented or rejected successor`)
      continue
    }
    if (from.lifecycle === to.lifecycle) continue
    for (const pairPath of pairPaths(from.path)) {
      if (!beforePaths.has(pairPath)) errors.push(`${from.path}: base is missing ${pairPath}`)
      if (afterPaths.has(pairPath)) errors.push(`${from.path}: head still contains ${pairPath}`)
    }
    for (const pairPath of pairPaths(to.path)) {
      if (beforePaths.has(pairPath)) errors.push(`${to.path}: base already contains ${pairPath}`)
      if (!afterPaths.has(pairPath)) errors.push(`${to.path}: head is missing ${pairPath}`)
    }
    const checked = checkAgentNoteTransition(
      from.path,
      git(root, ['show', `${scope.resolved.mergeBaseSha}:${from.path}`]),
      to.path,
      git(root, ['show', `${scope.resolved.headSha}:${to.path}`])
    )
    if (checked.transition) transitions.push(checked.transition)
    errors.push(...checked.errors.map((error) => `${identity}: ${error}`))
  }

  return { formatVersion: 1, resolved: scope.resolved, transitions, errors }
}

const renderReport = (report: NoteTransitionReport): string => {
  if (report.transitions.length === 0) return 'No Agent Note lifecycle transitions found.\n'
  return `${report.transitions
    .map(
      ({ identity, from, to, acceptanceCriteria }) =>
        `${identity}: ${from.lifecycle} → ${to.lifecycle}${acceptanceCriteria.length ? ` (${acceptanceCriteria.join(', ')})` : ''}`
    )
    .join('\n')}\n`
}

const main = (): void => {
  try {
    const { values } = parseArgs({
      args: process.argv.slice(2),
      allowPositionals: false,
      strict: true,
      options: {
        base: { type: 'string' },
        head: { type: 'string', default: 'HEAD' },
        json: { type: 'boolean', default: false }
      }
    })
    if (!values.base) throw new Error('missing required --base <ref>')
    const report = collectAgentNoteTransitionReport({ base: values.base, head: values.head })
    process.stdout.write(values.json ? `${JSON.stringify(report, null, 2)}\n` : renderReport(report))
    if (report.errors.length) {
      for (const error of report.errors) console.error(`  ${error}`)
      process.exitCode = 1
    }
  } catch (error) {
    console.error(`agent-notes:check-transition: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

if (require.main === module) main()
