import { CHERRYAI_DEFAULT_MODEL_ID, CHERRYAI_PROVIDER_ID } from '@shared/data/presets/cherryai'
import { type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import {
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
  isWebSearchModel
} from '@shared/utils/model'
import { describe, expect, it } from 'vitest'

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
  it('reads capability state from v2 Model.capabilities', () => {
    const model = createModel([
      MODEL_CAPABILITY.REASONING,
      MODEL_CAPABILITY.FUNCTION_CALL,
      MODEL_CAPABILITY.IMAGE_RECOGNITION,
      MODEL_CAPABILITY.WEB_SEARCH
    ])

    expect(isReasoningModel(model)).toBe(true)
    expect(isFunctionCallingModel(model)).toBe(true)
    expect(isVisionModel(model)).toBe(true)
    expect(isWebSearchModel(model)).toBe(true)
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
    expect(isWebSearchModel(model)).toBe(false)
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

    it('classifies dedicated speech-to-text / text-to-speech only by explicit capability', () => {
      expect(isSpeechToTextModel(createModel([MODEL_CAPABILITY.AUDIO_TRANSCRIPT]))).toBe(true)
      expect(isTextToSpeechModel(createModel([MODEL_CAPABILITY.AUDIO_GENERATION]))).toBe(true)
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
})
