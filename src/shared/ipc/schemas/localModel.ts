import {
  LOCAL_MODEL_DOWNLOAD_RESULTS,
  LOCAL_MODEL_ERROR_CODES,
  LOCAL_MODEL_KINDS,
  LOCAL_MODEL_STATUSES,
  type LocalModelErrorCode,
  type LocalModelKind
} from '@shared/data/presets/localModel'
import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * Local downloadable model IPC — drives the model cards in the Environment
 * Dependencies settings (status / download / cancel / remove). One route family
 * parameterized by `model` (`embedding` | `ocr`); the main handler dispatches to
 * the owning download service. Progress is pushed back as a `download_progress`
 * event tagged with the same `model`.
 *
 * Two blocks per the framework's two-axis model:
 *   - Request schemas are zod *values* (renderer→main, untrusted → always parsed).
 *   - Event schemas are pure *types* (main→renderer, main is the TCB → not parsed).
 */

/** Every route is addressed by which local model it targets. */
const modelInput = z.object({ model: z.enum(LOCAL_MODEL_KINDS) })

// ── Request: renderer→main calls (zod values, always parsed) ──
export const localModelRequestSchemas = {
  // `errorCode` is present exactly when `status` is 'error' and says why (failed
  // download vs. incomplete files on disk), so the cards can word the notice.
  'local_model.get_status': defineRoute({
    input: modelInput,
    output: z.object({ status: z.enum(LOCAL_MODEL_STATUSES), errorCode: z.enum(LOCAL_MODEL_ERROR_CODES).optional() })
  }),
  // All coalesced callers receive the same terminal result; only genuine failures reject.
  'local_model.download': defineRoute({
    input: modelInput,
    output: z.object({ result: z.enum(LOCAL_MODEL_DOWNLOAD_RESULTS) })
  }),
  'local_model.cancel': defineRoute({ input: modelInput, output: z.void() }),
  // `removed: false` means the model was kept because something still depends on it
  // (an embedding model still wired to a knowledge base); the weights are not deleted.
  'local_model.remove': defineRoute({ input: modelInput, output: z.object({ removed: z.boolean() }) })
}

// ── Event: main→renderer pushes (pure types, never parsed) ──
export type LocalModelEventSchemas = {
  // Streamed while a model downloads; `percent` is 0–100, `status` is the backend stage.
  // `loaded`/`total`/`file` come from the embedding (transformers.js) backend only.
  'local_model.download_progress': {
    model: LocalModelKind
    status: string
    percent: number
    errorCode?: LocalModelErrorCode
    loaded?: number
    total?: number
    file?: string
  }
}
