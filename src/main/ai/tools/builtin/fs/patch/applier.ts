/**
 * Apply a parsed `Patch` IR against the real filesystem.
 *
 * Three phases:
 *   1. Validate + plan in memory (pure reads). On any validation failure,
 *      NO files are touched.
 *   2. Commit writes (Add / Update) via `write-file-atomic` — per-file
 *      atomic + durable (fsync file + parent dir + cross-platform retry).
 *      On failure mid-stream, roll back already-committed writes by
 *      restoring captured originals (Update) or unlinking (Add).
 *   3. Commit deletes. On failure, restore deleted files from captured
 *      originals AND roll back committed writes.
 *
 * What this does and doesn't guarantee:
 *  - per-file atomic writes (durable): yes, via write-file-atomic
 *  - cross-file consistency on commit failure: yes, via in-memory rollback
 *  - process crash mid-commit: NO (would need a journal — out of scope
 *    for cherry's single-process desktop model; user re-issues the patch)
 *  - external concurrent writes (TOCTOU): NO — Phase 1 reads to Phase 2
 *    writes window; defer to OS-level locks if it ever matters
 *
 * Line-ending detection (CRLF vs LF) per file: split on `\r?\n`, detect
 * which line-ending the file uses, join with the same on write.
 *
 * Context matching is exact: the hunk's `context` + `remove` lines (in
 * order) form an "expected slice" that must appear consecutively in the
 * file. Multiple matches → ambiguous-match error. No match → context-mismatch
 * with a 5-line window around the probable apply point.
 */

import fs from 'node:fs/promises'
import { isAbsolute } from 'node:path'

import writeFileAtomic from 'write-file-atomic'

import type { Hunk, Patch } from './parser'

export interface ApplyResult {
  results: Array<
    | { type: 'added'; path: string; lines: number }
    | { type: 'updated'; path: string; hunksApplied: number }
    | { type: 'deleted'; path: string }
  >
}

export interface ApplyError {
  reason: 'relative-path' | 'file-not-found' | 'file-exists' | 'context-mismatch' | 'ambiguous-match' | 'io-failure'
  path?: string
  hunkIndex?: number
  message: string
  /**
   * Up to 5 actual file lines around the location where the hunk *might*
   * have applied — the heuristic looks for the hunk's first context line
   * anywhere in the file and returns a 5-line window around the best
   * partial match. Only set on context-mismatch.
   */
  actualContext?: string[]
  /** 1-indexed line number of the first line in `actualContext`. */
  actualContextStart?: number
  /** Total lines in the target file — only set on context-mismatch. */
  totalLines?: number
  /** How many places in the file matched the hunk — only set on ambiguous-match. */
  matchCount?: number
}

export type ApplyOutcome = { ok: true; value: ApplyResult } | { ok: false; error: ApplyError }

interface PlanWrite {
  kind: 'add' | 'update'
  path: string
  newContent: string
  /** Captured original content for rollback. undefined for `kind: 'add'`. */
  originalContent?: string
}
interface PlanDelete {
  kind: 'delete'
  path: string
  /** Captured original content for rollback (delete is reversible by writing it back). */
  originalContent: string
}
type PlanItem = PlanWrite | PlanDelete

export async function applyPatch(patch: Patch): Promise<ApplyOutcome> {
  // ── Phase 1: validate + plan + capture originals ──
  const plan: PlanItem[] = []
  const results: ApplyResult['results'] = []

  for (const op of patch.ops) {
    if (!isAbsolute(op.path)) {
      return fail({ reason: 'relative-path', path: op.path, message: `Path must be absolute: ${op.path}` })
    }

    if (op.type === 'add') {
      if (await pathExists(op.path)) {
        return fail({ reason: 'file-exists', path: op.path, message: `Cannot add (file already exists): ${op.path}` })
      }
      plan.push({ kind: 'add', path: op.path, newContent: op.lines.join('\n') })
      results.push({ type: 'added', path: op.path, lines: op.lines.length })
      continue
    }

    if (op.type === 'delete') {
      let raw: string
      try {
        raw = await fs.readFile(op.path, 'utf-8')
      } catch {
        return fail({ reason: 'file-not-found', path: op.path, message: `Cannot delete (not found): ${op.path}` })
      }
      plan.push({ kind: 'delete', path: op.path, originalContent: raw })
      results.push({ type: 'deleted', path: op.path })
      continue
    }

    // op.type === 'update'
    let raw: string
    try {
      raw = await fs.readFile(op.path, 'utf-8')
    } catch {
      return fail({ reason: 'file-not-found', path: op.path, message: `Cannot update (not found): ${op.path}` })
    }
    const lineEnding = raw.includes('\r\n') ? '\r\n' : '\n'
    let lines = raw.split(/\r?\n/)

    for (let h = 0; h < op.hunks.length; h++) {
      const next = applyHunk(lines, op.hunks[h])
      if (next.ok) {
        lines = next.value
        continue
      }
      if (next.reason === 'ambiguous') {
        return fail({
          reason: 'ambiguous-match',
          path: op.path,
          hunkIndex: h,
          message: `Hunk ${h} matches ${next.matchCount} places in ${op.path}. Add more surrounding context lines, or specify an "@@ <anchor>" line, to disambiguate.`,
          matchCount: next.matchCount,
          totalLines: lines.length
        })
      }
      // 'no-match'
      const window = locateProbableMatch(lines, op.hunks[h])
      return fail({
        reason: 'context-mismatch',
        path: op.path,
        hunkIndex: h,
        message: `Hunk ${h} context did not match any range in ${op.path}.`,
        actualContext: window.lines,
        actualContextStart: window.start,
        totalLines: lines.length
      })
    }

    plan.push({
      kind: 'update',
      path: op.path,
      newContent: lines.join(lineEnding),
      originalContent: raw
    })
    results.push({ type: 'updated', path: op.path, hunksApplied: op.hunks.length })
  }

  // ── Phase 2: commit writes (per-file atomic via write-file-atomic) ──
  const committedWrites: PlanWrite[] = []
  for (const item of plan) {
    if (item.kind !== 'add' && item.kind !== 'update') continue
    try {
      await writeFileAtomic(item.path, item.newContent)
      committedWrites.push(item)
    } catch (err) {
      await rollbackWrites(committedWrites)
      return fail({
        reason: 'io-failure',
        path: item.path,
        message: `Write failed; previous changes rolled back. ${err instanceof Error ? err.message : String(err)}`
      })
    }
  }

  // ── Phase 3: commit deletes (after all writes succeeded) ──
  const completedDeletes: PlanDelete[] = []
  for (const item of plan) {
    if (item.kind !== 'delete') continue
    try {
      await fs.unlink(item.path)
      completedDeletes.push(item)
    } catch (err) {
      // Restore deletes that already happened, then roll back writes.
      for (const d of completedDeletes) {
        await safeRestore(d.path, d.originalContent)
      }
      await rollbackWrites(committedWrites)
      return fail({
        reason: 'io-failure',
        path: item.path,
        message: `Delete failed; previous changes rolled back. ${err instanceof Error ? err.message : String(err)}`
      })
    }
  }

  return { ok: true, value: { results } }
}

/**
 * Roll back already-committed writes after a later op fails.
 * Add ops: unlink the new file (it didn't exist before).
 * Update ops: restore the captured original content via writeFileAtomic.
 *
 * Rollback I/O failures are swallowed — at this point we've already failed
 * the patch; if rollback also fails we can't do better than logging-and-
 * returning the original io-failure to the caller.
 */
async function rollbackWrites(committed: PlanWrite[]): Promise<void> {
  for (const c of committed) {
    if (c.kind === 'add') {
      await fs.unlink(c.path).catch(() => {})
    } else {
      await safeRestore(c.path, c.originalContent ?? '')
    }
  }
}

async function safeRestore(absolutePath: string, content: string): Promise<void> {
  try {
    await writeFileAtomic(absolutePath, content)
  } catch {
    // Rollback failure — already in failure path; nothing more we can do.
  }
}

type ApplyHunkResult =
  | { ok: true; value: string[] }
  | { ok: false; reason: 'no-match' }
  | { ok: false; reason: 'ambiguous'; matchCount: number }

function applyHunk(lines: string[], hunk: Hunk): ApplyHunkResult {
  // "Expected slice" = the consecutive lines we expect to find in the
  // file at the apply point: every context line + every removed line,
  // in source order. (Add lines describe what to insert, not what's
  // present, so they're not part of the matcher.)
  const expected: string[] = []
  const replacement: string[] = []
  for (const hl of hunk.lines) {
    if (hl.type === 'context' || hl.type === 'remove') expected.push(hl.text)
    if (hl.type === 'context' || hl.type === 'add') replacement.push(hl.text)
  }

  if (expected.length === 0) {
    // Pure-add hunk with no context — would match anywhere; refuse rather
    // than guess. Codex format requires at least some anchor; return
    // mismatch so the model can fix the patch.
    return { ok: false, reason: 'no-match' }
  }

  // If the hunk specifies an `@@` anchor, narrow the search to lines
  // *at or after* the anchor — Codex's intended semantics for
  // disambiguating identical patterns elsewhere in the file. If the
  // anchor doesn't appear in the file at all, fail with no-match.
  let searchStart = 0
  if (hunk.anchor !== undefined) {
    const anchorIdx = lines.indexOf(hunk.anchor)
    if (anchorIdx < 0) return { ok: false, reason: 'no-match' }
    searchStart = anchorIdx
  }

  // Collect ALL match positions, not just the first. Multiple matches
  // mean the model didn't provide enough context to uniquely target the
  // edit — refuse rather than silently apply at the first occurrence.
  const matches: number[] = []
  for (let i = searchStart; i <= lines.length - expected.length; i++) {
    let match = true
    for (let j = 0; j < expected.length; j++) {
      if (lines[i + j] !== expected[j]) {
        match = false
        break
      }
    }
    if (match) matches.push(i)
  }

  if (matches.length === 0) return { ok: false, reason: 'no-match' }
  if (matches.length > 1) return { ok: false, reason: 'ambiguous', matchCount: matches.length }

  const i = matches[0]
  const before = lines.slice(0, i)
  const after = lines.slice(i + expected.length)
  return { ok: true, value: [...before, ...replacement, ...after] }
}

/**
 * On context mismatch, return a 5-line window around where the hunk
 * *probably* meant to apply. Heuristic:
 *   1. Find the hunk's first context-or-remove line as a literal in the
 *      file (so the model sees the actual content at the intended spot).
 *   2. If found, return 2 lines before + that line + 2 lines after.
 *   3. Else fall back to the file's first 5 lines so the model at least
 *      sees the file's actual head.
 */
function locateProbableMatch(lines: string[], hunk: Hunk): { lines: string[]; start: number } {
  const probe = hunk.lines.find((hl) => hl.type === 'context' || hl.type === 'remove')?.text
  if (probe !== undefined) {
    const idx = lines.indexOf(probe)
    if (idx >= 0) {
      const start = Math.max(0, idx - 2)
      const end = Math.min(lines.length, idx + 3)
      return { lines: lines.slice(start, end), start: start + 1 }
    }
  }
  return { lines: lines.slice(0, 5), start: 1 }
}

async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await fs.access(absolutePath)
    return true
  } catch {
    return false
  }
}

function fail(error: ApplyError): { ok: false; error: ApplyError } {
  return { ok: false, error }
}
