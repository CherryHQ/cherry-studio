import type { LocalModelKind } from '@shared/data/presets/localModel'

import { localEmbeddingDownloadService } from './LocalEmbeddingDownloadService'
import { localOcrDownloadService } from './LocalOcrDownloadService'

/**
 * Whether a local model can actually run right now.
 *
 * Callers gating work on a local model must use this instead of probing the
 * weight files themselves: the shared onnxruntime binary downloads separately
 * from the weights, so a weights-only check reports "ready" for a model the
 * inference worker cannot load — it dies with a bare
 * `Cannot find module ...onnxruntime_binding.node` instead of a message anyone
 * can act on. This routes through the same download services the settings cards
 * read, so UI and execution never disagree.
 */
export function isLocalModelReady(kind: LocalModelKind): boolean {
  const service = kind === 'embedding' ? localEmbeddingDownloadService : localOcrDownloadService
  return service.getStatus() === 'ready'
}
