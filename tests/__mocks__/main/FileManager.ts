import type { FileEntryId } from '@shared/data/types/file'
import type { FileUrlString } from '@shared/types/file'
import { vi } from 'vitest'

/**
 * Minimal FileManager mock. The DataApi read models resolve an uploaded logo's
 * `logoFileId` to a `file://` URL via `FileManager.getUrl` (see
 * `@data/services/utils/logoSrc`), so provider / mini-app DTOs expose a stable
 * `logoSrc` in tests. Deterministic path so assertions can predict it.
 */
const mockFileManager = {
  getUrl: vi.fn((id: FileEntryId): FileUrlString => `file:///mock/files/${id}.webp` as FileUrlString)
}

export const MockMainFileManagerExport = {
  fileManager: mockFileManager
}
