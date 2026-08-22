import type { ReasoningWireProfile } from '../schemas/reasoningWire'
import { defineProvider } from './types'
import { modeWire } from './wires'

const openAIThinkingWire: ReasoningWireProfile = modeWire('chat_template_kwargs.enable_thinking', {
  off: false,
  auto: true
})

const anthropicThinkingWire: ReasoningWireProfile = {
  off: {
    operations: [{ target: 'thinking.type', value: { source: 'literal', value: 'disabled' } }]
  },
  auto: {
    operations: [{ target: 'thinking.type', value: { source: 'literal', value: 'adaptive' } }]
  },
  effort: {
    operations: [
      { target: 'thinking.type', value: { source: 'literal', value: 'adaptive' } },
      { target: 'effort', value: { source: 'effort' } }
    ],
    effortMap: { minimal: 'low' }
  }
}

export default defineProvider({
  id: 'dots',
  name: 'Dots Studio',
  defaultChatEndpoint: 'openai-chat-completions',
  modelListSource: 'registry',
  endpointConfigs: {
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'https://note3-prev-api.askdiandian.com',
      dialect: { streamOptions: false },
      reasoningFormat: { type: 'openai-chat', wire: openAIThinkingWire }
    },
    'anthropic-messages': {
      adapterFamily: 'anthropic',
      baseUrl: 'https://note3-prev-api.askdiandian.com',
      reasoningFormat: { type: 'anthropic', wire: anthropicThinkingWire }
    }
  },
  metadata: {
    website: {
      apiKey: 'https://dots.ai/platform/apikeys',
      docs: 'https://dots.ai/platform/docs',
      models: 'https://huggingface.co/dots-studio/dots3-note-prev',
      official: 'https://dots.ai/'
    }
  },
  overrides: [
    {
      modelId: 'dots-3-note-preview',
      apiModelId: 'dots3-note-prev',
      capabilities: { remove: ['audio-recognition', 'video-recognition'] },
      endpointTypes: ['openai-chat-completions', 'anthropic-messages'],
      inputModalities: ['text', 'image'],
      reason: 'Dots transport currently verifies text and image input only',
      parameterSupport: {
        temperature: { supported: true },
        topP: { supported: true },
        topK: { supported: false },
        frequencyPenalty: false,
        presencePenalty: false,
        maxTokens: true,
        stopSequences: true,
        systemMessage: true
      }
    }
  ]
})
