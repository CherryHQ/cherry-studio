import { defineProvider } from './types'

/**
 * ComfyUI is a local node-graph server with no OpenAI surface: models are the
 * user's saved workflows and generation submits a graph. The declared endpoint
 * is the local host the transport talks to; only image generation routes here.
 */
export default defineProvider({
  id: 'comfyui',
  name: 'ComfyUI',
  availableInEditions: ['global', 'cn'],
  authOptional: true,
  endpointConfigs: {
    'openai-image-generation': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'http://localhost:8188'
    }
  },
  metadata: {
    website: {
      docs: 'https://docs.comfy.org/development/comfyui-server/comms_routes',
      official: 'https://www.comfy.org/'
    }
  }
})
