/**
 * Codex `apply_patch` envelope parser.
 *
 * Format:
 *   *** Begin Patch
 *   *** Add File: <path>          body lines start with `+`
 *   *** Update File: <path>       body has `@@` hunks of context/-/+ lines
 *   *** Delete File: <path>       no body
 *   *** End Patch
 *
 * Reference:
 *   https://developers.openai.com/api/docs/guides/tools-apply-patch
 *
 * The parser produces a tree IR; the applier (sibling module) consumes
 * it against a real filesystem. Parser is pure: no I/O, no side effects.
 */

export type HunkLine =
  | { type: 'context'; text: string }
  | { type: 'remove'; text: string }
  | { type: 'add'; text: string }

export interface Hunk {
  anchor?: string
  lines: HunkLine[]
}

export type PatchOp =
  | { type: 'add'; path: string; lines: string[] }
  | { type: 'update'; path: string; hunks: Hunk[] }
  | { type: 'delete'; path: string }

export interface Patch {
  ops: PatchOp[]
}

export type ParseResult = { ok: true; value: Patch } | { ok: false; error: string }

const BEGIN = '*** Begin Patch'
const END = '*** End Patch'
const ADD = '*** Add File:'
const UPDATE = '*** Update File:'
const DELETE = '*** Delete File:'
const HUNK = '@@'

export function parsePatch(input: string): ParseResult {
  const lines = input.split('\n')

  const beginIdx = lines.indexOf(BEGIN)
  if (beginIdx < 0) return fail('Missing "*** Begin Patch" marker.')
  const endIdx = lines.indexOf(END, beginIdx + 1)
  if (endIdx < 0) return fail('Missing "*** End Patch" marker.')

  for (let i = 0; i < beginIdx; i++) {
    if (lines[i].length > 0) return fail('Unexpected content before "*** Begin Patch".')
  }
  for (let i = endIdx + 1; i < lines.length; i++) {
    if (lines[i].length > 0) return fail('Unexpected content after "*** End Patch".')
  }

  const body = lines.slice(beginIdx + 1, endIdx)
  const ops: PatchOp[] = []
  let i = 0

  while (i < body.length) {
    const line = body[i]
    if (line.startsWith(ADD)) {
      const path = extractPath(line, ADD)
      if (!path) return fail('Add File marker missing path.')
      const result = collectAddBody(body, i + 1)
      if (!result.ok) return result
      ops.push({ type: 'add', path, lines: result.value })
      i = result.next
    } else if (line.startsWith(DELETE)) {
      const path = extractPath(line, DELETE)
      if (!path) return fail('Delete File marker missing path.')
      const next = i + 1
      if (next < body.length && !isOpMarker(body[next])) {
        return fail(`Delete File body must be empty (got "${body[next]}").`)
      }
      ops.push({ type: 'delete', path })
      i = next
    } else if (line.startsWith(UPDATE)) {
      const path = extractPath(line, UPDATE)
      if (!path) return fail('Update File marker missing path.')
      const result = collectUpdateBody(body, i + 1)
      if (!result.ok) return result
      ops.push({ type: 'update', path, hunks: result.value })
      i = result.next
    } else if (line.length === 0) {
      i++
    } else {
      return fail(`Unexpected line at top level of patch body: "${line}"`)
    }
  }

  return { ok: true, value: { ops } }
}

function extractPath(markerLine: string, marker: string): string | null {
  const raw = markerLine.slice(marker.length).trim()
  return raw.length > 0 ? raw : null
}

function isOpMarker(line: string): boolean {
  return line.startsWith(ADD) || line.startsWith(UPDATE) || line.startsWith(DELETE)
}

function collectAddBody(
  body: string[],
  start: number
): { ok: true; value: string[]; next: number } | { ok: false; error: string } {
  const out: string[] = []
  let i = start
  while (i < body.length && !isOpMarker(body[i])) {
    const line = body[i]
    if (line.startsWith('+')) {
      out.push(line.slice(1))
      i++
    } else {
      return fail(`Add File body lines must start with "+" (got "${line}").`)
    }
  }
  return { ok: true, value: out, next: i }
}

function collectUpdateBody(
  body: string[],
  start: number
): { ok: true; value: Hunk[]; next: number } | { ok: false; error: string } {
  const hunks: Hunk[] = []
  let i = start
  let current: Hunk | undefined

  while (i < body.length && !isOpMarker(body[i])) {
    const line = body[i]
    if (line.startsWith(HUNK)) {
      if (current) hunks.push(current)
      const anchor = line.slice(HUNK.length).trim()
      current = { anchor: anchor.length > 0 ? anchor : undefined, lines: [] }
      i++
      continue
    }
    if (!current) {
      return fail(`Update File body must start with "@@" hunk marker (got "${line}").`)
    }
    if (line.startsWith(' ')) {
      current.lines.push({ type: 'context', text: line.slice(1) })
    } else if (line.startsWith('-')) {
      current.lines.push({ type: 'remove', text: line.slice(1) })
    } else if (line.startsWith('+')) {
      current.lines.push({ type: 'add', text: line.slice(1) })
    } else {
      return fail(`Unrecognised hunk line prefix (got "${line}").`)
    }
    i++
  }
  if (current) hunks.push(current)
  if (hunks.length === 0) {
    return fail('Update File requires at least one hunk.')
  }
  return { ok: true, value: hunks, next: i }
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error }
}
