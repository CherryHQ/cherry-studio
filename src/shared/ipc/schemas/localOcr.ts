import { LOCAL_MODEL_STATUSES } from '@shared/data/presets/localEmbedding'
import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * Local OCR model IPC — drives the OCR model card in the Environment Dependencies
 * settings (status / download / cancel / remove). Files are downloaded in the main
 * process (mirror-aware HTTP); progress is pushed back as a `download_progress` event.
 *
 * Two blocks per the framework's two-axis model:
 *   - Request schemas are zod *values* (renderer→main, untrusted → always parsed).
 *   - Event schemas are pure *types* (main→renderer, main is the TCB → not parsed).
 */

// ── Request: renderer→main calls (zod values, always parsed) ──
export const localOcrRequestSchemas = {
  'local_ocr.get_status': defineRoute({
    input: z.void(),
    output: z.object({ status: z.enum(LOCAL_MODEL_STATUSES) })
  }),
  // Resolves only when the download completes (or rejects on failure/cancel).
  'local_ocr.download': defineRoute({ input: z.void(), output: z.void() }),
  'local_ocr.cancel': defineRoute({ input: z.void(), output: z.void() }),
  'local_ocr.remove': defineRoute({ input: z.void(), output: z.void() })
}

// ── Event: main→renderer pushes (pure types, never parsed) ──
export type LocalOcrEventSchemas = {
  // Streamed while the model downloads; `percent` is 0–100 across all model files.
  'local_ocr.download_progress': {
    status: string
    percent: number
  }
}
