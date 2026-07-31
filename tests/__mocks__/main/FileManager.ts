import { vi } from 'vitest'

import type { ContentHash, FileEntryId } from '@shared/data/types/file'
import type { FileUrlString } from '@shared/types/file'

interface MockFileSweepStats {
  entriesInDb: number
  direntsScanned: number
  filesOnDisk: number
  bytesOnDisk: number
  plannedDeleteCount: number
  plannedDeleteBytes: number
  actualDeleteCount: number
  actualDeleteBytes: number
  statFailedCount: number
  scanDurationMs: number
}

type MockFileSweepReport = MockFileSweepStats &
  (
    | { outcome: 'completed' }
    | { outcome: 'partial'; failedDeleteCount: number; failedSamples: readonly string[] }
    | { outcome: 'aborted'; abortReason: 'count-fraction' | 'byte-fraction' | 'pending-restore' }
    | { outcome: 'failed'; errorMessage: string }
  )

function emptyOrphanFileReport(): MockFileSweepReport {
  return {
    outcome: 'completed',
    entriesInDb: 0,
    direntsScanned: 0,
    filesOnDisk: 0,
    bytesOnDisk: 0,
    plannedDeleteCount: 0,
    plannedDeleteBytes: 0,
    actualDeleteCount: 0,
    actualDeleteBytes: 0,
    statFailedCount: 0,
    scanDurationMs: 0
  }
}

/**
 * Minimal FileManager mock. The DataApi read models project an uploaded logo's
 * ref-row file id onto the DTO's `logoSrc` via `FileManager.getUrl` (see
 * `rowToRuntimeProvider` / `rowToMiniApp`, which skip the call entirely when the
 * slot is empty), so provider / mini-app DTOs expose a stable URL in tests.
 * Deterministic path so assertions can predict it.
 */
const mockFileManager = {
  getUrl: vi.fn((id: FileEntryId): FileUrlString => `file:///mock/files/${id}.webp` as FileUrlString),
  findInternalByContentHash: vi.fn((_contentHash: ContentHash) => []),
  inspectOrphanFiles: vi.fn(async () => emptyOrphanFileReport()),
  cleanupOrphanFiles: vi.fn(async () => emptyOrphanFileReport())
}

export const MockMainFileManagerExport = {
  fileManager: mockFileManager
}
