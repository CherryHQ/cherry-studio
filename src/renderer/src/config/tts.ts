import { TTSProvider } from '@renderer/types/tts'

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
      format: 'mp3'
    },
    voices: [
      { id: 'alloy', name: 'Alloy', lang: 'en-US', gender: 'neutral' },
      { id: 'echo', name: 'Echo', lang: 'en-US', gender: 'male' },
      { id: 'fable', name: 'Fable', lang: 'en-US', gender: 'neutral' },
      { id: 'onyx', name: 'Onyx', lang: 'en-US', gender: 'male' },
      { id: 'nova', name: 'Nova', lang: 'en-US', gender: 'female' },
      { id: 'shimmer', name: 'Shimmer', lang: 'en-US', gender: 'female' }
    ]
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
      role: 'default'
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
      use_speaker_boost: true
    },
    voices: []
  },
  {
    id: 'siliconflow',
    type: 'siliconflow',
    name: '硅基流动 (SiliconFlow)',
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
      voice: 'alex'
    },
    voices: []
  },
  {
    id: 'tencentcloud',
    type: 'tencentcloud',
    name: '腾讯云语音合成 (Tencent Cloud)',
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
      codec: 'wav'
    },
    voices: []
  },
  {
    id: 'googlecloud',
    type: 'googlecloud',
    name: 'Google Cloud Text-to-Speech',
    enabled: false,
    isSystem: true,
    settings: {
      rate: 1.0,
      pitch: 1.0,
      volume: 1.0,
      voice: 'en-US-Wavenet-D',
      format: 'mp3',
      sampleRate: 24000,
      autoPlay: false
    },
    voices: []
  }
]

export const TTS_PROVIDER_CONFIG = {
  'web-speech': {
    name: 'Web Speech API',
    description: '浏览器内置的语音合成功能',
    requiresApiKey: false,
    supportedFeatures: ['rate', 'pitch', 'volume', 'voice']
  },
  openai: {
    name: 'OpenAI TTS',
    description: 'OpenAI 的高质量语音合成服务，支持多种语音和格式，支持流式合成',
    requiresApiKey: true,
    supportedFeatures: ['voice', 'rate', 'model', 'format', 'streaming'],
    supportsStreaming: true
  },
  azure: {
    name: 'Azure Speech',
    description: 'Microsoft Azure 语音服务，支持多种语言和语音样式，支持流式合成',
    requiresApiKey: true,
    supportedFeatures: ['rate', 'pitch', 'voice', 'region', 'speaking_style', 'role', 'streaming'],
    supportsStreaming: true
  },
  elevenlabs: {
    name: 'ElevenLabs',
    description: '高质量的 AI 语音合成服务，支持语音克隆和情感调节，支持流式合成',
    requiresApiKey: true,
    supportedFeatures: ['voice', 'model', 'stability', 'similarity_boost', 'style', 'use_speaker_boost', 'streaming'],
    supportsStreaming: true
  },
  siliconflow: {
    name: '硅基流动 (SiliconFlow)',
    description: '硅基流动高质量语音合成服务，支持多语言和情感控制，兼容 OpenAI API',
    requiresApiKey: true,
    supportedFeatures: ['rate', 'voice', 'model', 'format', 'sample_rate']
  },
  tencentcloud: {
    name: '腾讯云语音合成 (Tencent Cloud)',
    description: '腾讯云高质量语音合成服务，支持多种中英文音色，支持流式合成，企业级稳定性',
    requiresApiKey: true,
    supportedFeatures: ['rate', 'voice', 'region', 'sampleRate', 'codec', 'streaming'],
    supportsStreaming: true
  },
  googlecloud: {
    name: 'Google Cloud Text-to-Speech',
    description: 'Google Cloud 提供的高质量语音合成服务，支持多种语言和 WaveNet 语音',
    requiresApiKey: true,
    supportedFeatures: ['rate', 'pitch', 'volume', 'voice', 'format', 'sampleRate']
  }
}
