import type { MessageProvenance, HistorySource } from '@shared/data/types/conversationImport'
import type { MessageData, MessageSnapshot } from '@shared/data/types/message'
import type { ImportDiagnostic, ImportFilterReason } from '@shared/ipc/schemas/conversationImport'

export const IMPORT_LIMITS = {
  line: 4 * 1024 * 1024,
  session: 32 * 1024 * 1024,
  batch: 128 * 1024 * 1024,
  sessions: 100,
  previewMs: 15 * 60 * 1000
} as const

export interface NormalizedMessage {
  role: 'user' | 'assistant' | 'system'
  data: MessageData
  status: 'success' | 'error' | 'paused'
  timestamp: number
  provenance: MessageProvenance & { originalMessageId: string; originalTimestamp?: string; inferredTimestamp: boolean }
  messageSnapshot: MessageSnapshot | null
}
export interface NormalizedSession {
  filteredReason?: ImportFilterReason
  source: HistorySource
  originalSessionId: string
  sourcePaths: string[]
  sourceVersion?: string
  title: string
  workingDirectory?: string
  messages: NormalizedMessage[]
  branches: string[]
  selectedBranchId?: string
  sourceFingerprint: string
  inputBytes: number
  diagnostics: ImportDiagnostic[]
  skippedRecords: number
  downgradedParts: number
}
export interface SessionRef {
  filteredReason?: ImportFilterReason
  path: string
  sourcePaths?: string[]
  originalSessionId?: string
  title?: string
}
export interface HistorySourceAdapter {
  source: HistorySource
  discover(root: string, signal: AbortSignal): AsyncIterable<SessionRef>
  read(ref: SessionRef, signal: AbortSignal, branchId?: string): Promise<NormalizedSession>
}
