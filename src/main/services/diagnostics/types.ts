import type { AbsoluteFilePath } from '@shared/types/file'

export type DiagnosticFileSourceKind = 'logs' | 'traces'
export type DiagnosticSourceKind = DiagnosticFileSourceKind | 'chatRecords'
export type DiagnosticWarning =
  | 'malformed_lines'
  | 'scan_failed'
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
  readonly kind: DiagnosticFileSourceKind
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

export interface ChatRecordStats {
  bytes: number
  messageCount: number
  recordCount: number
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
