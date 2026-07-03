import { defineProvider } from './types'

export default defineProvider({
  id: 'ovms',
  name: 'OpenVINO Model Server',
  endpointConfigs: {
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'http://localhost:8000/v3/'
    }
  },
  metadata: {
    website: {
      docs: 'https://docs.openvino.ai/2025/model-server/ovms_what_is_openvino_model_server.html',
      models: 'https://www.modelscope.cn/organization/OpenVINO',
      official: 'https://www.intel.com/content/www/us/en/developer/tools/openvino-toolkit/overview.html'
    }
  }
})
