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

async function cleanupSharedRuntimeAfterInterruptedDownload(model: LocalModelKind): Promise<void> {
  // 'downloading' counts as still needed — the sibling may be awaiting the same
  // coalesced binary download.
  const siblingStatus = siblingFor(model).getStatus()
  try {
    await onnxRuntimeBinaryService.removeIfUnused(siblingStatus === 'ready' || siblingStatus === 'downloading')
  } catch (cleanupError) {
    // Best-effort: a locked file must not turn a cancellation into a failure or
    // mask the original download error.
    logger.warn('failed to clean up the shared onnxruntime binary after an interrupted download', {
      error: String(cleanupError)
    })
  }
}

/**
 * Thin adapters for the local model routes — each dispatches by `model` to the
 * owning download service (`LocalEmbeddingDownloadService` for transformers.js,
 * `LocalOcrDownloadService` for PaddleOCR), which owns the on-disk lifecycle and
 * the download. `download` resolves only when the download finishes.
 */
export const localModelHandlers: IpcHandlersFor<typeof localModelRequestSchemas> = {
  'local_model.get_status': async ({ model }) => serviceFor(model).getStatusInfo(),
  'local_model.download': async ({ model }) => {
    try {
      const result = await serviceFor(model).download()
      if (result === 'cancelled') {
        await cleanupSharedRuntimeAfterInterruptedDownload(model)
      }
      return { result }
    } catch (error) {
      // Drop the shared onnxruntime binary so a half-installed runtime doesn't read as
      // ready. The model weights are deliberately left alone — a failed download never
      // writes partials, so whatever is on disk is a complete earlier download.
      await cleanupSharedRuntimeAfterInterruptedDownload(model)
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
