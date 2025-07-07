import {
  DEFAULT_AUDIO_FORMATS,
  DEFAULT_MODEL_IDS,
  DEFAULT_REGIONS,
  DEFAULT_SAMPLE_RATES,
  DEFAULT_VOICE_IDS
} from '@renderer/constants/tts'
import { TTSProvider } from '@renderer/types/tts'

import { AzureTTSProvider } from './AzureTTSProvider'
import { BaseTTSProvider } from './BaseTTSProvider'
import { ElevenLabsProvider } from './ElevenLabsProvider'
import { GoogleCloudTTSProvider } from './GoogleCloudTTSProvider'
import { OpenAITTSProvider } from './OpenAITTSProvider'
// =================================================================================
// 导入依赖
// =================================================================================
// ... (其他导入保持不变)
// 新增：导入我们刚刚创建的 SelfHostTTSProvider
import { SelfHostTTSProvider } from './SelfHostTTSProvider'
import { SiliconFlowProvider } from './SiliconFlowProvider'
import { TencentCloudTTSProvider } from './TencentCloudTTSProvider'
import { WebSpeechProvider } from './WebSpeechProvider'

export class TTSProviderFactory {
  /**
   * 创建 TTS 供应商实例
   */
  static create(provider: TTSProvider): BaseTTSProvider {
    switch (provider.type) {
      case 'web-speech':
        return new WebSpeechProvider(provider)
      case 'openai':
        return new OpenAITTSProvider(provider)
      case 'azure':
        return new AzureTTSProvider(provider)
      case 'elevenlabs':
        return new ElevenLabsProvider(provider)
      case 'siliconflow':
        return new SiliconFlowProvider(provider)
      case 'tencentcloud':
        return new TencentCloudTTSProvider(provider)
      case 'googlecloud':
        return new GoogleCloudTTSProvider(provider)
      // 新增：为自建服务添加创建逻辑
      case 'self_host':
        return new SelfHostTTSProvider(provider)
      default:
        // 默认使用 Web Speech API
        return new WebSpeechProvider(provider)
    }
  }

  /**
   * 检查供应商类型是否支持
   */
  static isSupported(type: string): boolean {
    // 新增：将 'self_host' 添加到支持列表中
    return [
      'web-speech',
      'openai',
      'azure',
      'elevenlabs',
      'siliconflow',
      'tencentcloud',
      'googlecloud',
      'self_host'
    ].includes(type)
  }

  /**
   * 获取所有支持的供应商类型
   */
  static getSupportedTypes(): string[] {
    // 新增：将 'self_host' 添加到支持列表中
    return ['web-speech', 'openai', 'azure', 'elevenlabs', 'siliconflow', 'tencentcloud', 'googlecloud', 'self_host']
  }

  /**
   * 检查浏览器是否支持 Web Speech API
   */
  static isWebSpeechSupported(): boolean {
    return 'speechSynthesis' in window
  }

  /**
   * 获取供应商的显示名称
   */
  static getProviderDisplayName(type: string): string {
    const names: Record<string, string> = {
      'web-speech': 'Web Speech API',
      openai: 'OpenAI TTS',
      azure: 'Azure Speech',
      elevenlabs: 'ElevenLabs',
      siliconflow: '硅基流动',
      tencentcloud: '腾讯云语音合成',
      googlecloud: 'Google Cloud',
      // 新增：为自建服务提供一个用户友好的名称
      self_host: '自建服务'
    }
    return names[type] || type
  }

  /**
   * 检查供应商是否需要 API Key
   */
  static requiresApiKey(type: string): boolean {
    // 修改：自建服务通常使用 endpoint 而不是 API Key
    return !['web-speech', 'self_host'].includes(type)
  }

  /**
   * 获取供应商支持的功能
   */
  static getSupportedFeatures(type: string): string[] {
    const features: Record<string, string[]> = {
      'web-speech': ['rate', 'pitch', 'volume', 'voice'],
      openai: ['voice', 'rate'],
      azure: ['rate', 'pitch', 'voice'],
      elevenlabs: ['voice'],
      siliconflow: ['rate', 'voice', 'model', 'format', 'sample_rate'],
      tencentcloud: ['rate', 'voice', 'region', 'sampleRate', 'codec'],
      googlecloud: ['rate', 'pitch', 'volume', 'voice', 'format', 'sampleRate'],
      // 新增：定义自建服务支持的功能（暂时只有 voice）
      self_host: ['voice']
    }
    return features[type] || []
  }

  /**
   * 获取供应商的默认设置
   */
  static getDefaultSettings(type: string) {
    const defaults: Record<string, any> = {
      'web-speech': {
        rate: 1.0,
        pitch: 1.0,
        volume: 1.0,
        autoPlay: false
      },
      openai: {
        rate: 1.0,
        pitch: 1.0,
        volume: 1.0,
        voice: DEFAULT_VOICE_IDS.openai,
        autoPlay: false,
        streaming: false // 支持流式合成
      },
      azure: {
        rate: 1.0,
        pitch: 1.0,
        volume: 1.0,
        voice: DEFAULT_VOICE_IDS.azure,
        autoPlay: false,
        streaming: false // 支持流式合成
      },
      elevenlabs: {
        rate: 1.0,
        pitch: 1.0,
        volume: 1.0,
        voice: DEFAULT_VOICE_IDS.elevenlabs,
        autoPlay: false,
        streaming: false // 支持流式合成
      },
      siliconflow: {
        rate: 1.0,
        pitch: 1.0,
        volume: 1.0,
        voice: DEFAULT_VOICE_IDS.siliconflow,
        model: DEFAULT_MODEL_IDS.siliconflow,
        format: DEFAULT_AUDIO_FORMATS.siliconflow,
        sample_rate: DEFAULT_SAMPLE_RATES.siliconflow,
        autoPlay: false,
        streaming: false // 支持流式合成
      },
      tencentcloud: {
        rate: 1.0,
        pitch: 1.0,
        volume: 1.0,
        voice: DEFAULT_VOICE_IDS.tencentcloud,
        region: DEFAULT_REGIONS.tencentcloud,
        sampleRate: DEFAULT_SAMPLE_RATES.tencentcloud,
        codec: 'wav',
        autoPlay: false
      },
      googlecloud: {
        rate: 1.0,
        pitch: 1.0,
        volume: 1.0,
        voice: DEFAULT_VOICE_IDS.googlecloud,
        format: DEFAULT_AUDIO_FORMATS.googlecloud,
        sampleRate: DEFAULT_SAMPLE_RATES.googlecloud,
        autoPlay: false
      },
      // 新增：为自建服务定义默认配置
      self_host: {
        url: '', // 默认 url 为空，需要用户填写
        voice: 'default',
        autoPlay: false
      }
    }
    return defaults[type] || defaults['web-speech']
  }
}
