import { defineProvider } from './types'

/**
 * ComfyUI is a local image-generation server with no authentication.
 * It only serves the paintings (image generation) surface; chat and
 * embedding endpoints are not available.
 */
export default defineProvider({
  id: 'comfyui',
  name: 'ComfyUI',
  availableInEditions: ['global', 'cn'],
  authOptional: true,
  endpointConfigs: {
    'openai-responses': {
      adapterFamily: 'openai-responses',
      baseUrl: 'http://localhost:8188'
    }
  },
  metadata: {
    website: {
      docs: 'https://github.com/comfyanonymous/ComfyUI',
      official: 'https://comfui.org'
    }
  }
})
