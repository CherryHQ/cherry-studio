export type TTSProviderType =
  | 'web-speech'
  | 'openai'
  | 'azure'
  | 'elevenlabs'
  | 'siliconflow'
  | 'tencentcloud'
  | 'googlecloud'

export interface TTSVoice {
  id: string
  name: string
  lang: string
  gender?: 'male' | 'female' | 'neutral'
  default?: boolean
}

export interface TTSProvider {
  id: string
  type: TTSProviderType
  name: string
  enabled: boolean
  isSystem?: boolean
  apiKey?: string
  apiHost?: string
  settings: TTSProviderSettings
  voices: TTSVoice[]
}

export interface TTSProviderSettings {
  rate: number
  pitch: number
  volume: number
  voice?: string
  autoPlay: boolean
  // 流式合成设置
  streaming?: boolean // 是否启用流式合成
  pauseSupport?: boolean // 是否启用暂停功能（流式音频缓存模式）
  // OpenAI 特有设置
  model?: string // tts-1, tts-1-hd
  format?: string // mp3, opus, aac, flac, wav, pcm
  // Azure 和 TencentCloud 共用设置
  region?: string // 地域设置
  // Azure 特有设置
  speaking_style?: string // 语音样式
  role?: string // 语音角色
  // ElevenLabs 特有设置
  stability?: number
  similarity_boost?: number
  style?: number
  use_speaker_boost?: boolean
  // SiliconFlow 特有设置
  sample_rate?: number // 采样率
  // TencentCloud 特有设置
  secretKey?: string // 腾讯云 SecretKey
  sampleRate?: number // 采样率
  codec?: string // 音频编码格式
}

export interface TTSState {
  providers: TTSProvider[]
  currentProvider: string | null
  globalSettings: {
    enabled: boolean
    autoPlay: boolean
  }
}

export interface TTSSpeakOptions {
  text: string
  voice?: string
  rate?: number
  pitch?: number
  volume?: number
  streaming?: boolean // 是否使用流式合成
}
