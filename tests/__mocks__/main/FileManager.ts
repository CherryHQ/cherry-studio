import type { ContentHash, FileEntryId } from '@shared/data/types/file'
import type { FileUrlString } from '@shared/types/file'
import { vi } from 'vitest'

/**
 * Minimal FileManager mock. The DataApi read models project an uploaded logo's
 * ref-row file id onto the DTO's `logoSrc` via `FileManager.getUrl` (see
 * `rowToRuntimeProvider` / `rowToMiniApp`, which skip the call entirely when the
 * slot is empty), so provider / mini-app DTOs expose a stable URL in tests.
 * Deterministic path so assertions can predict it.
 */
const mockFileManager = {
  getUrl: vi.fn((id: FileEntryId): FileUrlString => `file:///mock/files/${id}.webp` as FileUrlString),
  findInternalByContentHash: vi.fn((_contentHash: ContentHash) => [])
}

export const MockMainFileManagerExport = {
  fileManager: mockFileManager
}
