import { loggerService } from '@logger'
import {
  localEmbeddingDownloadService,
  localOcrDownloadService,
  onnxRuntimeBinaryService
} from '@main/services/localModel'
import type { LocalModelKind } from '@shared/data/presets/localModel'
import type { localModelRequestSchemas } from '@shared/ipc/schemas/localModel'
import type { IpcHandlersFor } from '@shared/ipc/types'

const logger = loggerService.withContext('localModelHandlers')

/** The two download services share one method shape — pick by `model`. */
function serviceFor(model: LocalModelKind) {
  return model === 'embedding' ? localEmbeddingDownloadService : localOcrDownloadService
}

/** The other of the two — checked on removal to decide whether the onnxruntime
 * binary they share is still needed. */
function siblingFor(model: LocalModelKind) {
  return model === 'embedding' ? localOcrDownloadService : localEmbeddingDownloadService
}

/**
 * Thin adapters for the local model routes — each dispatches by `model` to the
 * owning download service (`LocalEmbeddingDownloadService` for transformers.js,
 * `LocalOcrDownloadService` for PaddleOCR), which owns the on-disk lifecycle and
 * the download. `download` resolves only when the download finishes.
 */
export const localModelHandlers: IpcHandlersFor<typeof localModelRequestSchemas> = {
  'local_model.get_status': async ({ model }) => ({ status: serviceFor(model).getStatus() }),
  'local_model.download': async ({ model }) => {
    try {
      await serviceFor(model).download()
    } catch (error) {
      // The service already dropped its own partial weights (cleanupAfterError)
      // before rejecting; also drop the shared onnxruntime binary so a cancelled
      // or failed download leaves no footprint. 'downloading' counts as still
      // needed — the sibling may be awaiting the same coalesced binary download.
      const siblingStatus = siblingFor(model).getStatus()
      try {
        await onnxRuntimeBinaryService.removeIfUnused(siblingStatus === 'ready' || siblingStatus === 'downloading')
      } catch (cleanupError) {
        // Best-effort: a locked file must not mask the original download error.
        logger.warn('failed to clean up the shared onnxruntime binary after an aborted download', {
          error: String(cleanupError)
        })
      }
      throw error
    }
  },
  'local_model.cancel': async ({ model }) => serviceFor(model).cancel(),
  'local_model.remove': async ({ model }) => {
    const result = await serviceFor(model).remove()
    // Only the removed feature's own weights are gone here — the shared onnxruntime
    // binary is a separate concern, cleaned up only once the sibling feature is gone too.
    if (result.removed) {
      await onnxRuntimeBinaryService.removeIfUnused(siblingFor(model).getStatus() === 'ready')
    }
    return result
  }
}
