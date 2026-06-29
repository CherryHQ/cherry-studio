import { localEmbeddingDownloadService } from '@main/ai/provider/custom/localEmbedding/LocalEmbeddingDownloadService'
import type { localEmbeddingRequestSchemas } from '@shared/ipc/schemas/localEmbedding'
import type { IpcHandlersFor } from '@shared/ipc/types'

/**
 * Thin adapters for the local embedding model routes — each delegates to
 * `LocalEmbeddingDownloadService`, which owns the on-disk lifecycle and the
 * inference-worker download. `download` resolves only when the download finishes.
 */
export const localEmbeddingHandlers: IpcHandlersFor<typeof localEmbeddingRequestSchemas> = {
  'local_embedding.get_status': async () => ({ status: localEmbeddingDownloadService.getStatus() }),
  'local_embedding.download': async () => localEmbeddingDownloadService.download(),
  'local_embedding.cancel': async () => localEmbeddingDownloadService.cancel(),
  'local_embedding.remove': async () => localEmbeddingDownloadService.remove()
}
