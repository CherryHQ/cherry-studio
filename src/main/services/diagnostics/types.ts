import type { AbsoluteFilePath } from '@shared/types/file'

export type DiagnosticSourceKind = 'logs' | 'traces'
export type DiagnosticWarning =
  | 'malformed_lines'
  | 'size_limit_reached'
  | 'source_changed'
  | 'source_unreadable'
  | 'system_info_unavailable'

export interface DiagnosticTimeRange {
  readonly fromMs: number
  readonly toMs: number
}

export interface SourceIdentity {
  readonly dev: number
  readonly ino: number
  readonly modifiedAt: number
  readonly size: number
}

export interface SourceCandidate {
  readonly archiveName: string
  readonly eligibleBytes: number
  readonly identity: SourceIdentity
  readonly kind: DiagnosticSourceKind
  readonly latestAt: number
  readonly malformedLineCount: number
  readonly sourcePath: AbsoluteFilePath
}

export interface SourceCollection {
  readonly logs: SourceCandidate[]
  readonly traces: SourceCandidate[]
  readonly warnings: Set<DiagnosticWarning>
}

export interface SourceStats {
  bytes: number
  fileCount: number
  malformedLineCount: number
}

export interface StagedSource {
  readonly archiveName: string
  readonly bytes: number
  readonly kind: DiagnosticSourceKind
  readonly malformedLineCount: number
  readonly path: AbsoluteFilePath
}

export interface CrashDumpInventory {
  readonly files: ReadonlyArray<{
    readonly createdAt: string
    readonly size: number
  }>
  readonly totalBytes: number
}
