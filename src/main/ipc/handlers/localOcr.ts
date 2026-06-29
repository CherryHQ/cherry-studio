import { localOcrDownloadService } from '@main/features/fileProcessing/processors/local-paddleocr/LocalOcrDownloadService'
import type { localOcrRequestSchemas } from '@shared/ipc/schemas/localOcr'
import type { IpcHandlersFor } from '@shared/ipc/types'

/**
 * Thin adapters for the local OCR model routes — each delegates to
 * `LocalOcrDownloadService`, which owns the on-disk model lifecycle and the
 * mirror-aware download. `download` resolves only when the download finishes.
 */
export const localOcrHandlers: IpcHandlersFor<typeof localOcrRequestSchemas> = {
  'local_ocr.get_status': async () => ({ status: localOcrDownloadService.getStatus() }),
  'local_ocr.download': async () => localOcrDownloadService.download(),
  'local_ocr.cancel': async () => localOcrDownloadService.cancel(),
  'local_ocr.remove': async () => localOcrDownloadService.remove()
}
