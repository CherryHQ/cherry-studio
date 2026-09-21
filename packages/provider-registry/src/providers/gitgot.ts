import { defineProvider } from './types'

/**
 * GitGot is an OpenAI-compatible endpoint serving open-weight models.
 *
 * `reasoningFormat` is `openai-chat` without an `off` operation on purpose:
 * the host has no single switch that turns reasoning off across its
 * catalogue. `reasoning_effort` grades gpt-oss, acts as an on/off toggle on
 * the DeepSeek V4 models — where omitting the field is the only way to
 * disable it — and is ignored by the Kimi models, which always reason.
 * Declaring one wire operation would misdescribe two thirds of the models.
 */
export default defineProvider({
  id: 'gitgot',
  name: 'GitGot',
  availableInEditions: ['global'],
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'https://inference.gitgot.ai/v1',
      reasoningFormat: { type: 'openai-chat' }
    }
  },
  metadata: {
    website: {
      apiKey: 'https://gitgot.ai/dashboard',
      docs: 'https://gitgot.ai/docs/quickstart',
      models: 'https://inference.gitgot.ai/v1/models',
      official: 'https://gitgot.ai'
    }
  }
})
