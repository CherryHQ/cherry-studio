/**
 * Stuck-loop and excessive-read detection for exploratory file tools (Read, Grep, Glob).
 *
 * Enforces:
 * 1. Identical-call loop: calling the same exploration tool with identical parameters repeatedly.
 *    Soft warnings at `EXPLORER_IDENTICAL_THRESHOLD` (3) and 4, hard denial at `EXPLORER_IDENTICAL_HARD_THRESHOLD` (5).
 * 2. Same-file slice read cap: reading slices of the same file up to `EXPLORER_SAME_FILE_CAP` (10) times
 *    without code modifications. Soft warnings at 7, 8, 9, hard denial at 10.
 * 3. Excessive-read / exploration budget: repeatedly consuming context across files without progress
 *    through mutating tools (Edit, Write, MultiEdit, NotebookEdit).
 *    Soft warnings at 10, 15, 20, 25, 28, 29, hard denial & steer at `EXPLORER_CAP_HARD_THRESHOLD` (30).
 *
 * A completed workspace mutation resets consecutive run counters and clears the slice read count
 * for the mutated file.
 */

import path from 'node:path'

import { isMac, isWin } from '@main/core/platform'

/** Exploration tools monitored for stuck loops and consecutive read budgets. */
export const EXPLORER_TOOLS: ReadonlySet<string> = new Set(['Read', 'Grep', 'Glob'])

/** Identical tool-call run length at which the next call is allowed with a soft warning. */
export const EXPLORER_IDENTICAL_THRESHOLD = 3
/** Identical tool-call run length at which the next call is denied outright. */
export const EXPLORER_IDENTICAL_HARD_THRESHOLD = 5

/**
 * Maximum slice reads allowed on the same file without workspace mutation.
 * Allows up to 10 completed reads (with last-chance warning at 10); the 11th incoming read is denied.
 */
export const EXPLORER_SAME_FILE_CAP = 10

/** Consecutive exploration calls without code mutations at which warnings begin. */
export const EXPLORER_CAP_THRESHOLD = 10
/** Consecutive exploration calls without code mutations at which exploration tools are denied. */
export const EXPLORER_CAP_HARD_THRESHOLD = 30

export interface FileTracker {
  readCount: number
}

export interface ExplorerState {
  consecutiveReads: number
  lastSignature: string
  identicalSignatureRun: number
  files: Map<string, FileTracker>
}

export interface ExplorerLoopEvaluation {
  identicalRun: number
  consecutiveReads: number
  sameFileCapReached?: boolean
  fileReadCount?: number
  filePath?: string
}

/**
 * Normalizes file paths for comparison and deduplication.
 * Canonicalizes path separators, resolves redundant relative segments (./, ../, //),
 * strips trailing slashes, converts workspace-contained absolute paths to relative paths,
 * and conforms to host filesystem case-sensitivity semantics
 * (case-insensitive on Windows and macOS default, case-preserving on Linux).
 */
export function normalizePath(
  p: string | undefined,
  caseInsensitive: boolean = isMac || isWin,
  cwd: string = process.cwd()
): string {
  if (!p || typeof p !== 'string') return ''
  const trimmed = p.trim()
  if (!trimmed) return ''

  let normalized = trimmed.replace(/\\/g, '/')
  if (path.isAbsolute(trimmed)) {
    const rel = path.relative(cwd, trimmed).replace(/\\/g, '/')
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
      normalized = rel || '.'
    }
  }

  normalized = path.posix.normalize(normalized)
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1)
  }
  return caseInsensitive ? normalized.toLowerCase() : normalized
}

/** Canonicalizes tool name and its arguments so key order and formatting differences do not drift. */
export function normalizeExplorerSignature(
  toolName: string,
  input: Readonly<Record<string, unknown>> | undefined
): string {
  if (!input) return `${toolName}:{}`

  const sortedKeys = Object.keys(input).sort()
  const sortedObj: Record<string, unknown> = {}
  for (const k of sortedKeys) {
    const val = input[k]
    if ((k === 'file_path' || k === 'path') && typeof val === 'string') {
      sortedObj[k] = normalizePath(val)
    } else {
      sortedObj[k] = val
    }
  }
  return `${toolName}:${JSON.stringify(sortedObj)}`
}

export function createInitialExplorerState(): ExplorerState {
  return {
    consecutiveReads: 0,
    lastSignature: '',
    identicalSignatureRun: 0,
    files: new Map()
  }
}

/** Peeks loop status for an incoming tool call before it executes. */
export function evaluateIncomingExplorerCall(
  state: ExplorerState,
  toolName: string,
  input: Readonly<Record<string, unknown>> | undefined
): ExplorerLoopEvaluation {
  const signature = normalizeExplorerSignature(toolName, input)
  const nextIdenticalRun = signature === state.lastSignature ? state.identicalSignatureRun + 1 : 1
  const nextConsecutiveReads = state.consecutiveReads + 1

  const evalResult: ExplorerLoopEvaluation = {
    identicalRun: nextIdenticalRun,
    consecutiveReads: nextConsecutiveReads
  }

  const rawPath =
    typeof input?.file_path === 'string' ? input.file_path : typeof input?.path === 'string' ? input.path : undefined
  const normPath = normalizePath(rawPath)

  if (toolName === 'Read' && normPath) {
    evalResult.filePath = rawPath
    const fileRecord = state.files.get(normPath)
    if (fileRecord) {
      evalResult.fileReadCount = fileRecord.readCount + 1
      if (fileRecord.readCount >= EXPLORER_SAME_FILE_CAP) {
        evalResult.sameFileCapReached = true
      }
    } else {
      evalResult.fileReadCount = 1
    }
  }

  return evalResult
}

/** Updates explorer state with an incoming explorer tool call. */
export function recordExplorerCallState(
  state: ExplorerState,
  toolName: string,
  input: Readonly<Record<string, unknown>> | undefined
): void {
  const signature = normalizeExplorerSignature(toolName, input)
  state.consecutiveReads++
  if (signature === state.lastSignature) {
    state.identicalSignatureRun++
  } else {
    state.identicalSignatureRun = 1
    state.lastSignature = signature
  }

  const rawPath =
    typeof input?.file_path === 'string' ? input.file_path : typeof input?.path === 'string' ? input.path : undefined
  const normPath = normalizePath(rawPath)

  if (toolName === 'Read' && normPath) {
    const fileRecord = state.files.get(normPath)
    if (!fileRecord) {
      state.files.set(normPath, { readCount: 1 })
    } else {
      fileRecord.readCount++
    }
  }
}

/**
 * Resets the explorer state when a workspace mutation occurs.
 * If a mutated file path is provided, ONLY that file's readCount is reset to 0.
 * The consecutive unmutated exploration count is always reset to 0.
 */
export function recordExplorerMutationState(state: ExplorerState, mutatedFilePath?: string): void {
  const normPath = normalizePath(mutatedFilePath)
  if (normPath && state.files.has(normPath)) {
    const fileRecord = state.files.get(normPath)
    if (fileRecord) {
      fileRecord.readCount = 0
    }
  }
  state.consecutiveReads = 0
  state.lastSignature = ''
  state.identicalSignatureRun = 0
}

/**
 * Resets the explorer state at the start of a new user turn (UserPromptSubmit).
 * Fresh user turns grant a clean slate for all files and exploration budgets.
 */
export function resetExplorerTurnState(state: ExplorerState): void {
  state.consecutiveReads = 0
  state.lastSignature = ''
  state.identicalSignatureRun = 0
  state.files.clear()
}
