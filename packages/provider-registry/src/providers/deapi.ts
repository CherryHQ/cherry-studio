import type { ImageModeDef } from '../schemas/model'
import { defineProvider } from './types'

const DEAPI_BASE_URL = 'https://oai.deapi.ai/v1'

const squareSizes = ['512x512', '768x768', '1024x1024']

const generateMode = (sizes: string[]): ImageModeDef => ({
  supports: {
    size: { default: '1024x1024', options: sizes, render: 'chips', type: 'enum' },
    numImages: { default: 1, max: 4, min: 1, type: 'range' }
  }
})

const editMode = (maxInputImages: number): ImageModeDef => ({
  maxInputImages,
  supports: { numImages: { default: 1, max: 2, min: 1, type: 'range' } }
})

const textToSpeech = {
  capabilities: { force: ['audio-generation' as const] },
  endpointTypes: ['openai-text-to-speech' as const],
  inputModalities: ['text' as const],
  outputModalities: ['audio' as const]
}

const transcription = {
  capabilities: { force: ['audio-transcript' as const] },
  endpointTypes: ['openai-audio-transcription' as const],
  inputModalities: ['audio' as const],
  outputModalities: ['text' as const]
}

const textToVideo = {
  capabilities: { force: ['video-generation' as const] },
  endpointTypes: ['openai-video-generation' as const],
  inputModalities: ['text' as const],
  outputModalities: ['video' as const]
}

/**
 * deAPI's OpenAI-compatible gateway serves media only: images, embeddings, speech, transcription
 * and video. It has no chat endpoint, so (like ComfyUI) no `defaultChatEndpoint` is declared.
 * `/v1/models` returns bare native ids, so every served model is listed here with its endpoint type;
 * otherwise the speech/video models would be classified as chat models.
 */
export default defineProvider({
  id: 'deapi',
  name: 'deAPI',
  availableInEditions: ['global'],
  endpointConfigs: {
    'openai-image-generation': { adapterFamily: 'openai-compatible', baseUrl: DEAPI_BASE_URL },
    'openai-image-edit': { adapterFamily: 'openai-compatible', baseUrl: DEAPI_BASE_URL },
    'openai-embeddings': { adapterFamily: 'openai-compatible', baseUrl: DEAPI_BASE_URL }
  },
  metadata: {
    website: {
      apiKey: 'https://app.deapi.ai/register',
      docs: 'https://docs.deapi.ai/openai-compatibility',
      models: 'https://docs.deapi.ai/models',
      official: 'https://deapi.ai'
    }
  },
  overrides: [
    // Images (strongest first)
    {
      apiModelId: 'ZImageTurbo_INT8',
      modelId: 'z-image-turbo',
      name: 'Z-Image Turbo',
      ownedBy: 'alibaba',
      capabilities: { force: ['image-generation'] },
      endpointTypes: ['openai-image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image'],
      imageGeneration: { modes: { generate: generateMode(squareSizes) } }
    },
    {
      apiModelId: 'Flux_2_Klein_4B_BF16',
      modelId: 'flux-2-klein-4b',
      endpointTypes: ['openai-image-generation', 'openai-image-edit'],
      imageGeneration: { modes: { generate: generateMode(squareSizes), edit: editMode(3) } }
    },
    {
      apiModelId: 'Flux1schnell',
      modelId: 'flux-1-schnell',
      endpointTypes: ['openai-image-generation'],
      imageGeneration: {
        modes: { generate: generateMode([...squareSizes, '1024x1536', '1536x1024']) }
      }
    },
    {
      apiModelId: 'ZAnimeDistill_8Step_INT8',
      modelId: 'z-anime-distill',
      name: 'Z-Anime Distill',
      capabilities: { force: ['image-generation'] },
      endpointTypes: ['openai-image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image'],
      imageGeneration: { modes: { generate: generateMode(squareSizes) } }
    },
    {
      apiModelId: 'QwenImageEdit_Plus_NF4',
      modelId: 'qwen-image-edit-plus',
      name: 'Qwen-Image-Edit Plus',
      ownedBy: 'alibaba',
      capabilities: { force: ['image-generation'] },
      endpointTypes: ['openai-image-edit'],
      inputModalities: ['text', 'image'],
      outputModalities: ['image'],
      imageGeneration: { modes: { edit: editMode(1) } }
    },
    // Embeddings (1024-d)
    { apiModelId: 'Bge_M3_FP16', modelId: 'bge-m3', endpointTypes: ['openai-embeddings'] },
    // Speech, transcription and video: listed so they are not offered as chat models
    { apiModelId: 'Kokoro', modelId: 'kokoro', name: 'Kokoro', ...textToSpeech },
    { apiModelId: 'Chatterbox', modelId: 'chatterbox', name: 'Chatterbox', ...textToSpeech },
    {
      apiModelId: 'Qwen3_TTS_12Hz_1_7B_CustomVoice',
      modelId: 'qwen3-tts-custom-voice',
      name: 'Qwen3 TTS 1.7B CustomVoice',
      ownedBy: 'alibaba',
      ...textToSpeech
    },
    {
      apiModelId: 'Qwen3_TTS_12Hz_1_7B_VoiceDesign',
      modelId: 'qwen3-tts-voice-design',
      name: 'Qwen3 TTS 1.7B VoiceDesign',
      ownedBy: 'alibaba',
      ...textToSpeech
    },
    {
      apiModelId: 'WhisperLargeV3Ct2',
      modelId: 'whisper-large-v3-ct2',
      name: 'Whisper Large v3 (CTranslate2)',
      ownedBy: 'openai',
      ...transcription
    },
    { apiModelId: 'WhisperLargeV3', modelId: 'whisper-large-v3', ...transcription },
    {
      apiModelId: 'Ltx2_5_22B_Dist_INT8',
      modelId: 'ltx-2-5-22b-distilled',
      name: 'LTX-2.5 22B Distilled',
      ...textToVideo
    },
    { apiModelId: 'MiniMaxH3_33B_Turbo_INT8', modelId: 'minimax-h3-turbo', name: 'MiniMax H3 Turbo', ...textToVideo },
    {
      apiModelId: 'Ltx2_3_22B_Dist_INT8',
      modelId: 'ltx-2-3-22b-distilled',
      name: 'LTX-2.3 22B Distilled',
      ...textToVideo
    },
    {
      apiModelId: 'Ltxv_13B_0_9_8_Distilled_FP8',
      modelId: 'ltx-video-13b-distilled',
      name: 'LTX-Video 13B Distilled',
      ...textToVideo
    }
  ]
})
