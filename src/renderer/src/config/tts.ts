import AzureProviderLogo from '@renderer/assets/images/models/microsoft.png'
import ElevenLabsProviderLogo from '@renderer/assets/images/providers/elevenlabs.png'
import GoogleProviderLogo from '@renderer/assets/images/providers/google.png'
// TTS Provider Logos
import OpenAiProviderLogo from '@renderer/assets/images/providers/openai.png'
import SiliconFlowProviderLogo from '@renderer/assets/images/providers/silicon.png'
import TencentCloudProviderLogo from '@renderer/assets/images/providers/tencent-cloud-ti.png'
import { OPENAI_TTS_VOICES } from '@renderer/constants/tts'
import { TTSProvider } from '@renderer/types/tts'

// TTS Provider Logo Map
const TTS_PROVIDER_LOGO_MAP = {
  'web-speech': undefined, // 浏览器内置，无需 logo
  openai: OpenAiProviderLogo,
  azure: AzureProviderLogo,
  elevenlabs: ElevenLabsProviderLogo,
  siliconflow: SiliconFlowProviderLogo,
  tencentcloud: TencentCloudProviderLogo,
  googlecloud: GoogleProviderLogo
} as const

export function getTTSProviderLogo(providerId: string) {
  return TTS_PROVIDER_LOGO_MAP[providerId as keyof typeof TTS_PROVIDER_LOGO_MAP]
}

export const INITIAL_TTS_PROVIDERS: TTSProvider[] = [
  {
    id: 'web-speech',
    type: 'web-speech',
    name: 'Web Speech API',
    enabled: true,
    isSystem: true,
    settings: {
      rate: 1.0,
      pitch: 1.0,
      volume: 1.0,
      autoPlay: false
    },
    voices: []
  },
  {
    id: 'openai',
    type: 'openai',
    name: 'OpenAI TTS',
    enabled: false,
    isSystem: true,
    settings: {
      rate: 1.0,
      pitch: 1.0,
      volume: 1.0,
      voice: 'alloy',
      autoPlay: false,
      model: 'tts-1',
      format: 'mp3',
      streaming: false,
      pauseSupport: false
    },
    voices: OPENAI_TTS_VOICES
  },
  {
    id: 'azure',
    type: 'azure',
    name: 'Azure Speech',
    enabled: false,
    isSystem: true,
    settings: {
      rate: 1.0,
      pitch: 1.0,
      volume: 1.0,
      autoPlay: false,
      region: 'eastus',
      speaking_style: 'general',
      role: 'default',
      streaming: false,
      pauseSupport: false
    },
    voices: []
  },
  {
    id: 'elevenlabs',
    type: 'elevenlabs',
    name: 'ElevenLabs',
    enabled: false,
    isSystem: true,
    settings: {
      rate: 1.0,
      pitch: 1.0,
      volume: 1.0,
      autoPlay: false,
      model: 'eleven_multilingual_v2',
      stability: 0.5,
      similarity_boost: 0.5,
      style: 0.0,
      use_speaker_boost: true,
      streaming: false,
      pauseSupport: false
    },
    voices: []
  },
  {
    id: 'siliconflow',
    type: 'siliconflow',
    name: '硅基流动',
    enabled: false,
    isSystem: true,
    settings: {
      rate: 1.0,
      pitch: 1.0,
      volume: 1.0,
      autoPlay: false,
      model: 'FunAudioLLM/CosyVoice2-0.5B',
      format: 'mp3',
      sample_rate: 44100,
      voice: 'alex',
      streaming: false,
      pauseSupport: false
    },
    voices: []
  },
  {
    id: 'tencentcloud',
    type: 'tencentcloud',
    name: '腾讯云语音合成',
    enabled: false,
    isSystem: true,
    settings: {
      rate: 1.0,
      pitch: 1.0,
      volume: 1.0,
      autoPlay: false,
      voice: '101001',
      region: 'ap-beijing',
      sampleRate: 16000,
      codec: 'wav',
      streaming: false,
      pauseSupport: false
    },
    voices: []
  },
  {
    id: 'googlecloud',
    type: 'googlecloud',
    name: 'Google Cloud',
    enabled: false,
    isSystem: true,
    settings: {
      rate: 1.0,
      pitch: 1.0,
      volume: 1.0,
      voice: 'en-US-Wavenet-D',
      format: 'mp3',
      sampleRate: 24000,
      autoPlay: false,
      streaming: false,
      pauseSupport: false
    },
    voices: []
  }
]

export const TTS_PROVIDER_CONFIG = {
  'web-speech': {
    name: 'Web Speech API',
    description: '浏览器内置的语音合成功能',
    requiresApiKey: false,
    supportedFeatures: ['rate', 'pitch', 'volume', 'voice'],
    websites: {
      official: 'https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API',
      docs: 'https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis'
    }
  },
  openai: {
    name: 'OpenAI TTS',
    description: 'OpenAI 的高质量语音合成服务，支持多种语音和格式，支持流式合成',
    requiresApiKey: true,
    supportedFeatures: ['voice', 'rate', 'model', 'format', 'streaming'],
    supportsStreaming: true,
    websites: {
      official: 'https://openai.com/',
      apiKey: 'https://platform.openai.com/api-keys',
      docs: 'https://platform.openai.com/docs/guides/text-to-speech',
      models: 'https://platform.openai.com/docs/models/tts'
    }
  },
  azure: {
    name: 'Azure Speech',
    description: 'Microsoft Azure 语音服务，支持多种语言和语音样式，支持流式合成',
    requiresApiKey: true,
    supportedFeatures: ['rate', 'pitch', 'voice', 'region', 'speaking_style', 'role', 'streaming'],
    supportsStreaming: true,
    websites: {
      official: 'https://azure.microsoft.com/en-us/products/ai-services/text-to-speech',
      apiKey: 'https://portal.azure.com/#create/Microsoft.CognitiveServicesSpeechServices',
      docs: 'https://docs.microsoft.com/en-us/azure/cognitive-services/speech-service/text-to-speech',
      models: 'https://docs.microsoft.com/en-us/azure/cognitive-services/speech-service/language-support#text-to-speech'
    }
  },
  elevenlabs: {
    name: 'ElevenLabs',
    description: '高质量的 AI 语音合成服务，支持语音克隆和情感调节，支持流式合成',
    requiresApiKey: true,
    supportedFeatures: ['voice', 'model', 'stability', 'similarity_boost', 'style', 'use_speaker_boost', 'streaming'],
    supportsStreaming: true,
    websites: {
      official: 'https://elevenlabs.io/',
      apiKey: 'https://elevenlabs.io/app/speech-synthesis',
      docs: 'https://docs.elevenlabs.io/api-reference/text-to-speech',
      models: 'https://docs.elevenlabs.io/speech-synthesis/models'
    }
  },
  siliconflow: {
    name: '硅基流动',
    description: '硅基流动高质量语音合成服务，支持多语言和情感控制，兼容 OpenAI API，支持流式合成',
    requiresApiKey: true,
    supportedFeatures: ['rate', 'voice', 'model', 'format', 'sample_rate', 'streaming'],
    supportsStreaming: true,
    websites: {
      official: 'https://siliconflow.cn/',
      apiKey: 'https://cloud.siliconflow.cn/account/ak',
      docs: 'https://docs.siliconflow.cn/api-reference/audio/speech',
      models: 'https://docs.siliconflow.cn/models'
    }
  },
  tencentcloud: {
    name: '腾讯云语音合成',
    description: '腾讯云高质量语音合成服务，支持多种中英文音色，支持真正的流式合成，企业级稳定性',
    requiresApiKey: true,
    supportedFeatures: ['rate', 'voice', 'region', 'sampleRate', 'codec', 'streaming'],
    supportsStreaming: true, // 支持 WebSocket 流式合成
    websites: {
      official: 'https://cloud.tencent.com/product/tts',
      apiKey: 'https://console.cloud.tencent.com/cam/capi',
      docs: 'https://cloud.tencent.com/document/product/1073',
      models: 'https://cloud.tencent.com/document/product/1073/37995'
    }
  },
  googlecloud: {
    name: 'Google Cloud',
    description: 'Google Cloud 提供的高质量语音合成服务，支持多种语言和 WaveNet 语音',
    requiresApiKey: true,
    supportedFeatures: ['rate', 'pitch', 'volume', 'voice', 'format', 'sampleRate'],
    websites: {
      official: 'https://cloud.google.com/text-to-speech',
      apiKey: 'https://console.cloud.google.com/apis/credentials',
      docs: 'https://cloud.google.com/text-to-speech/docs',
      models: 'https://cloud.google.com/text-to-speech/docs/voices'
    }
  }
}
