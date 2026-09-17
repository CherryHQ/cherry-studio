import { defineProvider } from './types'

/**
 * ComfyUI is a local node-graph server with no OpenAI surface: models are the
 * user's saved workflows and generation submits a graph. The declared endpoint
 * is the local host the transport talks to; only image generation routes here.
 *
 * Image generation is also the default endpoint, so settings treat the server's
 * address as this provider's address instead of falling back to a chat endpoint
 * the server does not serve.
 */
export default defineProvider({
  id: 'comfyui',
  name: 'ComfyUI',
  availableInEditions: ['global', 'cn'],
  authOptional: true,
  defaultChatEndpoint: 'openai-image-generation',
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
