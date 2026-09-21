import { defineProvider } from './types'

/**
 * ComfyUI is a local image-generation server with no authentication.
 *
 * It speaks its own node-graph HTTP API (`/prompt`, `/queue`, `/history`,
 * `/userdata/workflows/…`), not an OpenAI surface — so the endpoint is declared
 * with the bespoke `comfyui` adapter family, which is what routes the model to the
 * app's ComfyUI extension/provider (`extensions.ts`) instead of a generic
 * OpenAI-compatible adapter that would receive the server's web UI HTML. The host
 * takes no `/v1` namespace either (see `formatBaseURL` in `config.ts`).
 *
 * Only the paintings (image generation) surface exists; chat and embeddings have no
 * endpoint here and the provider throws rather than guessing a host that answers them.
 */
export default defineProvider({
  id: 'comfyui',
  name: 'ComfyUI',
  availableInEditions: ['global', 'cn'],
  authOptional: true,
  endpointConfigs: {
    'openai-image-generation': {
      adapterFamily: 'comfyui',
      baseUrl: 'http://localhost:8188'
    }
  },
  // A model *is* a saved workflow here, so the fetched list is the complete set:
  // delete the workflow in ComfyUI and the row is a leftover the user cannot
  // otherwise remove (it has no remote counterpart and no registry preset).
  // The model-management drawer reconciles those away when it opens.
  modelListIsAuthoritative: true,
  metadata: {
    website: {
      docs: 'https://docs.comfy.org',
      official: 'https://www.comfy.org'
    }
  }
})
