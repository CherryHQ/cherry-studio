import { LOCAL_MODEL_STATUSES } from '@shared/data/presets/localEmbedding'
import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * Local embedding model IPC — drives the model card in the Environment
 * Dependencies settings (status / download / cancel / remove). Download runs in
 * the inference worker (transformers.js + onnxruntime-node); progress is pushed
 * back as a `download_progress` event.
 *
 * Two blocks per the framework's two-axis model:
 *   - Request schemas are zod *values* (renderer→main, untrusted → always parsed).
 *   - Event schemas are pure *types* (main→renderer, main is the TCB → not parsed).
 */

// ── Request: renderer→main calls (zod values, always parsed) ──
export const localEmbeddingRequestSchemas = {
  'local_embedding.get_status': defineRoute({
    input: z.void(),
    output: z.object({ status: z.enum(LOCAL_MODEL_STATUSES) })
  }),
  // Resolves only when the download completes (or rejects on failure/cancel).
  'local_embedding.download': defineRoute({ input: z.void(), output: z.void() }),
  'local_embedding.cancel': defineRoute({ input: z.void(), output: z.void() }),
  'local_embedding.remove': defineRoute({ input: z.void(), output: z.void() })
}

// ── Event: main→renderer pushes (pure types, never parsed) ──
export type LocalEmbeddingEventSchemas = {
  // Streamed while the model downloads; `percent` is 0–100, `status` is the transformers.js stage.
  'local_embedding.download_progress': {
    status: string
    percent: number
    loaded?: number
    total?: number
    file?: string
  }
}
