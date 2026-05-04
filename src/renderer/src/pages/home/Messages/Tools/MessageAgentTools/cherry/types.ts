/**
 * Cherry-builtin tool input/output types.
 *
 * Hand-mirrored from the main-process zod schemas
 * (`src/main/ai/tools/builtin/...`). Keep in sync when those schemas
 * change. Long-term these should move to `@shared/ai/builtinTools` so
 * main and renderer share one source of truth — same as `kb__search`
 * and `web__search` already do.
 */

// ============================================================================
// fs__read
// ============================================================================

export interface FsReadInput {
  path: string
  offset?: number
  limit?: number
}

export type FsReadOutput =
  | { kind: 'text'; text: string; startLine: number; endLine: number; totalLines: number }
  | { kind: 'image'; data: string; mimeType: string }
  | { kind: 'pdf'; data: string; mediaType: 'application/pdf' }
  | { kind: 'media'; data: string; mediaType: string }
  | {
      kind: 'error'
      code:
        | 'relative-path'
        | 'not-found'
        | 'not-a-file'
        | 'binary'
        | 'too-large'
        | 'device-file'
        | 'pipe-or-socket'
        | 'parse-error'
        | 'unsupported-modality'
      message: string
    }

// ============================================================================
// fs__patch
// ============================================================================

export interface FsPatchInput {
  patch: string
}

export type FsPatchOpSummary =
  | { type: 'added'; path: string; lines: number }
  | { type: 'updated'; path: string; hunksApplied: number }
  | { type: 'deleted'; path: string }

export type FsPatchOutput =
  | { kind: 'applied'; results: FsPatchOpSummary[] }
  | { kind: 'parse-error'; message: string }
  | {
      kind: 'apply-error'
      reason: 'relative-path' | 'file-not-found' | 'file-exists' | 'context-mismatch' | 'ambiguous-match' | 'io-failure'
      path?: string
      hunkIndex?: number
      message: string
      actualContext?: string[]
      actualContextStart?: number
      totalLines?: number
      matchCount?: number
    }

// ============================================================================
// shell__exec
// ============================================================================

export interface ShellExecInput {
  command: string
  cwd?: string
  timeout?: number
}

export type ShellExecOutput =
  | {
      kind: 'completed'
      exitCode: number
      stdout: string
      stderr: string
      durationMs: number
      truncated?: boolean
    }
  | { kind: 'timeout'; stdout: string; stderr: string; timeoutMs: number }
  | { kind: 'error'; code: string; message: string }
