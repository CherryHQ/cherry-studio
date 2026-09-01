import {
  LOCAL_MODEL_BUNDLE_IDS,
  LOCAL_MODEL_CAPABILITIES,
  LOCAL_MODEL_DOWNLOAD_RESULTS,
  LOCAL_MODEL_ERROR_CODES,
  LOCAL_MODEL_STATUSES
} from '@shared/data/presets/localModel'
import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * Local downloadable model IPC — drives the model cards in the Environment
 * Dependencies settings. Every lifecycle route is parameterized by the bundle `id`
 * and dispatches through the local-model facade, so shipping another model adds a catalog
 * entry, not a route. `local_model.list` is what makes the cards catalog-driven;
 * the acceleration capability route reports platform support. Main publishes live
 * status through Shared Cache; this schema only defines the command surface.
 */

/** Input shared by routes that target one installable bundle. */
const bundleInput = z.object({ id: z.enum(LOCAL_MODEL_BUNDLE_IDS) })

// ── Request: renderer→main calls (zod values, always parsed) ──
export const localModelRequestSchemas = {
  'local_model.get_acceleration_capability': defineRoute({
    input: z.void(),
    output: z.object({ supported: z.boolean() })
  }),
  // Everything installable, in catalog order. `capability` is what the cards render
  // their name/icon from, so a new bundle needs no component change.
  'local_model.list': defineRoute({
    input: z.void(),
    output: z.object({
      models: z.array(z.object({ id: z.enum(LOCAL_MODEL_BUNDLE_IDS), capability: z.enum(LOCAL_MODEL_CAPABILITIES) }))
    })
  }),
  // `errorCode` is present exactly when `status` is 'error' and says why (failed
  // download vs. incomplete files on disk), so the cards can word the notice.
  'local_model.get_status': defineRoute({
    input: bundleInput,
    output: z.object({ status: z.enum(LOCAL_MODEL_STATUSES), errorCode: z.enum(LOCAL_MODEL_ERROR_CODES).optional() })
  }),
  // All coalesced callers receive the same terminal result; only genuine failures reject.
  'local_model.download': defineRoute({
    input: bundleInput,
    output: z.object({ result: z.enum(LOCAL_MODEL_DOWNLOAD_RESULTS) })
  }),
  'local_model.cancel': defineRoute({ input: bundleInput, output: z.void() }),
  // `removed: false` means the model was kept because something still depends on it
  // (an embedding model still wired to a knowledge base); the weights are not deleted.
  'local_model.remove': defineRoute({ input: bundleInput, output: z.object({ removed: z.boolean() }) })
}
