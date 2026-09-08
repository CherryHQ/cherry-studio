/**
 * Stuck-loop and excessive-read detection for exploratory file tools (Read, Grep, Glob).
 *
 * Parallels `bashNoProgress.ts`:
 * 1. Identical-call loop: calling the same exploration tool with identical parameters repeatedly
 *    (e.g., re-reading an unchanged file despite `Wasted call — file unchanged`). Soft warning at
 *    `EXPLORER_IDENTICAL_THRESHOLD` (3), hard denial at `EXPLORER_IDENTICAL_HARD_THRESHOLD` (5).
 * 2. Traversal cycle / backward jump: reading a file forward then jumping back to re-read earlier lines.
 * 3. Duplicate chunk / subset read: reading a range fully covered by an earlier read of the same file.
 * 4. Same-file slice read cap: reading slices of the same file up to `EXPLORER_SAME_FILE_CAP` (4) times
 *    without code modifications.
 * 5. Excessive-read / exploration budget: repeatedly consuming context across files without progress
 *    through mutating tools (Edit, Write, MultiEdit, NotebookEdit).
 *    Soft warning at `EXPLORER_CAP_THRESHOLD` (10), hard denial at `EXPLORER_CAP_HARD_THRESHOLD` (15).
 *
 * A completed workspace mutation resets consecutive run counters and clears the slice read count
 * for the mutated file, while preserving covered line intervals to prevent cycle re-reading.
 */

/** Exploration tools monitored for stuck loops and consecutive read budgets. */
export const EXPLORER_TOOLS: ReadonlySet<string> = new Set(['Read', 'Grep', 'Glob'])

/** Identical tool-call run length at which the next call is allowed with a soft warning. */
export const EXPLORER_IDENTICAL_THRESHOLD = 3
/** Identical tool-call run length at which the next call is denied outright. */
export const EXPLORER_IDENTICAL_HARD_THRESHOLD = 5

/** Maximum slice reads allowed on the same file without workspace mutation. */
export const EXPLORER_SAME_FILE_CAP = 4

/** Consecutive exploration calls without code mutations at which a warning is injected. */
export const EXPLORER_CAP_THRESHOLD = 10
/** Consecutive exploration calls without code mutations at which exploration tools are denied. */
export const EXPLORER_CAP_HARD_THRESHOLD = 15

export const EXPLORER_HISTORY_LIMIT = 32

export interface FileReadInterval {
  start: number
  end: number
}

export interface FileTracker {
  readCount: number
  lastOffset: number
  intervals: [number, number][]
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
  isCycle?: boolean
  isDuplicateChunk?: boolean
  sameFileCapReached?: boolean
  filePath?: string
  lastOffset?: number
  rangeStart?: number
  rangeEnd?: number
}

export function normalizePath(p: string | undefined): string {
  if (!p || typeof p !== 'string') return ''
  return p.trim().replace(/\\/g, '/').toLowerCase()
}

export function mergeIntervals(
  intervals: readonly [number, number][],
  newInterval: [number, number]
): [number, number][] {
  const all = [...intervals, newInterval].sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const cur of all) {
    if (merged.length === 0) {
      merged.push([cur[0], cur[1]])
    } else {
      const last = merged[merged.length - 1]
      if (cur[0] <= last[1] + 1) {
        last[1] = Math.max(last[1], cur[1])
      } else {
        merged.push([cur[0], cur[1]])
      }
    }
  }
  return merged
}

export function calculateOverlapRatio(intervals: readonly [number, number][], start: number, end: number): number {
  const targetLen = Math.max(1, end - start + 1)
  let coveredLen = 0
  for (const [iStart, iEnd] of intervals) {
    const oStart = Math.max(start, iStart)
    const oEnd = Math.min(end, iEnd)
    if (oStart <= oEnd) {
      coveredLen += oEnd - oStart + 1
    }
  }
  return coveredLen / targetLen
}

/** Canonicalizes tool name and its arguments so key order and formatting differences do not drift. */
export function normalizeExplorerSignature(
  toolName: string,
  input: Readonly<Record<string, unknown>> | undefined
): string {
  if (!input) return `${toolName}:{}`
  const targetPath =
    typeof input.file_path === 'string' ? input.file_path : typeof input.path === 'string' ? input.path : undefined

  if (targetPath) {
    const offset = typeof input.offset === 'number' ? `:${input.offset}` : ''
    const limit = typeof input.limit === 'number' ? `:${input.limit}` : ''
    const pattern = typeof input.pattern === 'string' ? `:${input.pattern.trim()}` : ''
    return `${toolName}:${normalizePath(targetPath)}${pattern}${offset}${limit}`
  }

  const sortedKeys = Object.keys(input).sort()
  const sortedObj: Record<string, unknown> = {}
  for (const k of sortedKeys) {
    sortedObj[k] = input[k]
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

  const rawPath = typeof input?.file_path === 'string' ? input.file_path : undefined
  const normPath = normalizePath(rawPath)

  if (toolName === 'Read' && normPath) {
    const fileRecord = state.files.get(normPath)
    if (fileRecord) {
      const offset = typeof input?.offset === 'number' ? input.offset : 1
      const limit = typeof input?.limit === 'number' ? input.limit : 2000
      const rangeEnd = offset + limit - 1
      const overlap = calculateOverlapRatio(fileRecord.intervals, offset, rangeEnd)

      evalResult.filePath = rawPath
      evalResult.lastOffset = fileRecord.lastOffset
      evalResult.rangeStart = offset
      evalResult.rangeEnd = rangeEnd

      // Traversal cycle / backward jump check (triggers if reading backward into previously covered lines)
      if (offset < fileRecord.lastOffset && overlap >= 0.5) {
        evalResult.isCycle = true
      } else if (overlap >= 0.95 && fileRecord.intervals.length > 0) {
        evalResult.isDuplicateChunk = true
      }

      if (fileRecord.readCount >= EXPLORER_SAME_FILE_CAP) {
        evalResult.sameFileCapReached = true
      }
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

  const rawPath = typeof input?.file_path === 'string' ? input.file_path : undefined
  const normPath = normalizePath(rawPath)

  if (toolName === 'Read' && normPath) {
    const offset = typeof input?.offset === 'number' ? input.offset : 1
    const limit = typeof input?.limit === 'number' ? input.limit : 2000
    const rangeEnd = offset + limit - 1

    let fileRecord = state.files.get(normPath)
    if (!fileRecord) {
      fileRecord = {
        readCount: 1,
        lastOffset: offset,
        intervals: [[offset, rangeEnd]]
      }
      state.files.set(normPath, fileRecord)
    } else {
      fileRecord.readCount++
      fileRecord.lastOffset = offset
      fileRecord.intervals = mergeIntervals(fileRecord.intervals, [offset, rangeEnd])
    }
  }
}

/**
 * Resets the explorer state when a workspace mutation occurs.
 * If a mutated file path is provided, ONLY that file's readCount is reset to 0,
 * but covered intervals are preserved to prevent dummy-edit cycle re-reads.
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
