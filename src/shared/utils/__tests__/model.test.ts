import { describe, expect, it } from 'vitest'

import { CHERRYAI_DEFAULT_MODEL_ID, CHERRYAI_PROVIDER_ID } from '@shared/data/presets/cherryai'
import { ENDPOINT_TYPE, type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import {
  deriveModelGroupName,
  isAudioModel,
  isEmbeddingModel,
  isFunctionCallingModel,
  isGatewayRoutableModel,
  isGenerateImageModel,
  isNonChatModel,
  isReasoningModel,
  isRerankModel,
  isSpeechToTextModel,
  isTextToSpeechModel,
  isVideoModel,
  isVisionModel,
  supportsDynamicallyLoadedTools
} from '@shared/utils/model'

const createModel = (capabilities: Model['capabilities'] = []): Model => ({
  id: 'openai::gpt-4o',
  providerId: 'openai',
  apiModelId: 'gpt-4o',
  name: 'gpt-4o',
  capabilities,
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false
})

describe('shared model capability helpers', () => {
  describe('deriveModelGroupName', () => {
    it.each([
      ['openai/gpt-4o', 'openai'],
      ['deepseek-v4-pro', 'deepseek'],
      ['gpt-5.6-sol', 'gpt'],
      ['codex-auto-review', 'codex'],
      ['hy3', undefined],
      ['  ', undefined]
    ])('derives %s as %s', (modelId, expected) => {
      expect(deriveModelGroupName(modelId)).toBe(expected)
    })
  })

  it('reads capability state from v2 Model.capabilities', () => {
    const model = createModel([
      MODEL_CAPABILITY.REASONING,
      MODEL_CAPABILITY.FUNCTION_CALL,
      MODEL_CAPABILITY.IMAGE_RECOGNITION
    ])

    expect(isReasoningModel(model)).toBe(true)
    expect(isFunctionCallingModel(model)).toBe(true)
    expect(isVisionModel(model)).toBe(true)
  })

  it('does not infer capabilities from model id or name at runtime', () => {
    const model: Model = {
      ...createModel(),
      id: 'google::gemini-3.1-pro-preview',
      apiModelId: 'gemini-3.1-pro-preview',
      name: 'gemini-3.1-pro-preview'
    }

    expect(isReasoningModel(model)).toBe(false)
    expect(isFunctionCallingModel(model)).toBe(false)
    expect(isVisionModel(model)).toBe(false)
  })

  it('keeps embedding, rerank, and image generation as explicit capability checks', () => {
    expect(isEmbeddingModel(createModel([MODEL_CAPABILITY.EMBEDDING]))).toBe(true)
    expect(isRerankModel(createModel([MODEL_CAPABILITY.RERANK]))).toBe(true)
    expect(isNonChatModel(createModel([MODEL_CAPABILITY.RERANK]))).toBe(true)
    expect(isGenerateImageModel(createModel([MODEL_CAPABILITY.IMAGE_GENERATION]))).toBe(true)
  })

  describe('audio/video modality vs. dedicated-model classification', () => {
    // A multimodal chat LLM (e.g. Gemini / GPT-4o): takes audio/video/image as input and
    // can emit audio, while still being a general chat model.
    const multimodalChatModel: Model = {
      ...createModel([MODEL_CAPABILITY.REASONING, MODEL_CAPABILITY.FUNCTION_CALL]),
      inputModalities: ['text', 'image', 'audio', 'video'],
      outputModalities: ['text', 'audio']
    }

    it('detects vision/audio/video input from inputModalities (intended — composer file gating relies on this)', () => {
      expect(isVisionModel(multimodalChatModel)).toBe(true)
      expect(isAudioModel(multimodalChatModel)).toBe(true)
      expect(isVideoModel(multimodalChatModel)).toBe(true)
    })

    it('does NOT classify an audio-in/out multimodal LLM as speech-to-text or text-to-speech', () => {
      expect(isSpeechToTextModel(multimodalChatModel)).toBe(false)
      expect(isTextToSpeechModel(multimodalChatModel)).toBe(false)
    })

    it('keeps a multimodal LLM selectable in chat (not a non-chat model)', () => {
      expect(isNonChatModel(multimodalChatModel)).toBe(false)
    })

    it('classifies dedicated speech-to-text / text-to-speech by explicit capability', () => {
      expect(isSpeechToTextModel(createModel([MODEL_CAPABILITY.AUDIO_TRANSCRIPT]))).toBe(true)
      expect(isTextToSpeechModel(createModel([MODEL_CAPABILITY.AUDIO_GENERATION]))).toBe(true)
    })

    it('classifies an audio-only input model as dedicated speech-to-text', () => {
      const speechToTextModel: Model = {
        ...createModel([MODEL_CAPABILITY.AUDIO_RECOGNITION]),
        inputModalities: ['audio'],
        outputModalities: ['text']
      }

      expect(isSpeechToTextModel(speechToTextModel)).toBe(true)
      expect(isNonChatModel(speechToTextModel)).toBe(true)
    })

    it('classifies a capability-exclusive primary endpoint as non-chat', () => {
      const embeddingModel: Model = {
        ...createModel(),
        endpointTypes: [ENDPOINT_TYPE.OPENAI_EMBEDDINGS]
      }

      expect(isNonChatModel(embeddingModel)).toBe(true)
    })
  })

  describe('isGatewayRoutableModel', () => {
    it('keeps an ordinary chat model', () => {
      expect(isGatewayRoutableModel(createModel())).toBe(true)
      expect(isGatewayRoutableModel(createModel([MODEL_CAPABILITY.REASONING]))).toBe(true)
    })

    it('excludes every non-chat class, including audio/video generation and transcription', () => {
      expect(isGatewayRoutableModel(createModel([MODEL_CAPABILITY.EMBEDDING]))).toBe(false)
      expect(isGatewayRoutableModel(createModel([MODEL_CAPABILITY.RERANK]))).toBe(false)
      expect(isGatewayRoutableModel(createModel([MODEL_CAPABILITY.IMAGE_GENERATION]))).toBe(false)
      expect(isGatewayRoutableModel(createModel([MODEL_CAPABILITY.VIDEO_GENERATION]))).toBe(false)
      expect(isGatewayRoutableModel(createModel([MODEL_CAPABILITY.AUDIO_GENERATION]))).toBe(false)
      expect(isGatewayRoutableModel(createModel([MODEL_CAPABILITY.AUDIO_TRANSCRIPT]))).toBe(false)
    })

    it('excludes the CherryAI managed default model', () => {
      const managedDefault: Model = {
        ...createModel(),
        id: `${CHERRYAI_PROVIDER_ID}::qwen`,
        providerId: CHERRYAI_PROVIDER_ID,
        apiModelId: CHERRYAI_DEFAULT_MODEL_ID
      }
      expect(isGatewayRoutableModel(managedDefault)).toBe(false)
    })

    it('excludes models of a provider id containing ":" (the gateway address cannot round-trip it)', () => {
      const colonProvider: Model = {
        ...createModel(),
        id: 'corp:west::gpt-4o',
        providerId: 'corp:west'
      }
      expect(isGatewayRoutableModel(colonProvider)).toBe(false)
    })
  })

  describe('supportsDynamicallyLoadedTools', () => {
    it.each([
      ['claude-sonnet-4-5', true],
      ['gpt-5.1', true],
      ['deepseek-v4-flash', true],
      ['qwen3.7-plus', true],
      // Kimi K3 is the only model in the family that accepts dynamically-loaded tool declarations.
      ['k3', true],
      ['kimi-k3', true],
      ['kimi-k3-0905-preview', true],
      // Everything else in the Kimi family rejects them with `tokenization failed`.
      ['kimi-for-coding', false],
      ['kimi-k2.5', false],
      ['kimi-k2-0711-preview', false],
      ['kimi-latest', false],
      ['moonshot-v1-128k', false],
      // Namespace prefixes and Claude Code's [1m] suffix must not break matching.
      ['provider:kimi-for-coding', false],
      ['provider:k3', true],
      ['kimi-for-coding[1m]', false],
      ['k3[1m]', true]
    ])('classifies %s as %s', (modelId, expected) => {
      expect(supportsDynamicallyLoadedTools(modelId)).toBe(expected)
    })
  })
})
