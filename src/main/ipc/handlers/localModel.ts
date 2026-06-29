import { localEmbeddingDownloadService } from '@main/features/localModel/LocalEmbeddingDownloadService'
import { localOcrDownloadService } from '@main/features/localModel/LocalOcrDownloadService'
import type { LocalModelKind } from '@shared/data/presets/localEmbedding'
import type { localModelRequestSchemas } from '@shared/ipc/schemas/localModel'
import type { IpcHandlersFor } from '@shared/ipc/types'

/** The two download services share one method shape — pick by `model`. */
function serviceFor(model: LocalModelKind) {
  return model === 'embedding' ? localEmbeddingDownloadService : localOcrDownloadService
}

/**
 * Thin adapters for the local model routes — each dispatches by `model` to the
 * owning download service (`LocalEmbeddingDownloadService` for transformers.js,
 * `LocalOcrDownloadService` for PaddleOCR), which owns the on-disk lifecycle and
 * the download. `download` resolves only when the download finishes.
 */
export const localModelHandlers: IpcHandlersFor<typeof localModelRequestSchemas> = {
  'local_model.get_status': async ({ model }) => ({ status: serviceFor(model).getStatus() }),
  'local_model.download': async ({ model }) => serviceFor(model).download(),
  'local_model.cancel': async ({ model }) => serviceFor(model).cancel(),
  'local_model.remove': async ({ model }) => serviceFor(model).remove()
}
