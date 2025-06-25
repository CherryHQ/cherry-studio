import { DEFAULT_MODEL_IDS, DEFAULT_VOICE_IDS, OPENAI_TTS_MODELS, OPENAI_TTS_VOICES } from '@renderer/constants/tts'
import { TTSSpeakOptions, TTSVoice } from '@renderer/types/tts'

import { BaseTTSProvider, TTSCheckResult } from './BaseTTSProvider'

export class OpenAITTSProvider extends BaseTTSProvider {
  async getVoices(): Promise<TTSVoice[]> {
    // OpenAI TTS 的固定语音列表
    return OPENAI_TTS_VOICES
  }

  /**
   * 获取可用的 TTS 模型列表
   */
  async getAvailableModels(): Promise<Array<{ id: string; name: string; description: string }>> {
    if (!this.provider.apiKey) {
      console.warn('[OpenAI TTS] No API key provided, returning default models')
      return OPENAI_TTS_MODELS
    }

    try {
      console.log('[OpenAI TTS] Fetching available models from API')
      const response = await fetch('https://api.openai.com/v1/models', {
        headers: {
          Authorization: `Bearer ${this.provider.apiKey}`,
          'Content-Type': 'application/json'
        }
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()

      // 过滤出 TTS 模型
      const ttsModels = data.data
        .filter((model: any) => model.id.startsWith('tts-'))
        .map((model: any) => {
          const defaultModel = OPENAI_TTS_MODELS.find((m) => m.id === model.id)
          return {
            id: model.id,
            name: defaultModel?.name || model.id,
            description: defaultModel?.description || `OpenAI TTS model: ${model.id}`
          }
        })

      console.log(`[OpenAI TTS] Found ${ttsModels.length} TTS models`)
      return ttsModels.length > 0 ? ttsModels : OPENAI_TTS_MODELS
    } catch (error) {
      console.error('[OpenAI TTS] Failed to fetch models:', error)
      // 返回默认模型列表作为后备
      return OPENAI_TTS_MODELS
    }
  }

  async speak(options: TTSSpeakOptions): Promise<void> {
    if (!this.validateApiKey()) {
      throw new Error('OpenAI API key is required')
    }

    // 停止当前播放
    this.stop()

    try {
      const volume = options.volume ?? this.provider.settings.volume ?? 1.0
      const useStreaming = options.streaming ?? this.provider.settings.streaming ?? false

      if (useStreaming) {
        // 流式合成
        const audioStream = await this.synthesizeSpeechStream(options)
        const mimeType = this.getMimeType(this.provider.settings.format || 'mp3')
        const enablePause = this.provider.settings.pauseSupport ?? false
        await this.audioPlayer.playStream(audioStream, mimeType, volume, { enablePause })
      } else {
        // 非流式合成
        const audioBlob = await this.synthesizeSpeech(options)
        await this.audioPlayer.playBlob(audioBlob, volume)
      }
    } catch (error) {
      throw this.handleError(error)
    }
  }

  async check(): Promise<TTSCheckResult> {
    try {
      if (!this.validateApiKey()) {
        return {
          valid: false,
          error: new Error('OpenAI API key is required')
        }
      }

      // 测试 API 连接
      const response = await fetch(`${this.getApiHost()}/v1/models`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.provider.apiKey}`,
          'Content-Type': 'application/json'
        }
      })

      if (!response.ok) {
        return {
          valid: false,
          error: new Error(`API check failed: ${response.status} ${response.statusText}`)
        }
      }

      return {
        valid: true,
        error: null
      }
    } catch (error) {
      return {
        valid: false,
        error: this.handleError(error)
      }
    }
  }

  protected getDefaultApiHost(): string {
    return 'https://api.openai.com'
  }

  /**
   * 调用 OpenAI TTS API 合成语音
   */
  private async synthesizeSpeech(options: TTSSpeakOptions): Promise<Blob> {
    const voice = options.voice || this.provider.settings.voice || DEFAULT_VOICE_IDS.openai
    const speed = options.rate ?? this.provider.settings.rate

    const response = await fetch(`${this.getApiHost()}/v1/audio/speech`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.provider.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.provider.settings.model || DEFAULT_MODEL_IDS.openai, // 支持 tts-1 和 tts-1-hd
        input: options.text,
        voice: voice,
        response_format: this.provider.settings.format || 'mp3', // 支持多种格式
        speed: Math.max(0.25, Math.min(4.0, speed)) // OpenAI 支持 0.25-4.0 的速度范围
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`OpenAI TTS API error: ${response.status} ${errorText}`)
    }

    return await response.blob()
  }

  /**
   * 调用 OpenAI TTS API 流式合成语音
   */
  private async synthesizeSpeechStream(options: TTSSpeakOptions): Promise<ReadableStream<Uint8Array>> {
    const voice = options.voice || this.provider.settings.voice || 'alloy'
    const speed = options.rate ?? this.provider.settings.rate

    const response = await fetch(`${this.getApiHost()}/v1/audio/speech`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.provider.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.provider.settings.model || 'tts-1',
        input: options.text,
        voice: voice,
        response_format: this.provider.settings.format || 'mp3',
        speed: Math.max(0.25, Math.min(4.0, speed))
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`OpenAI TTS API error: ${response.status} ${errorText}`)
    }

    if (!response.body) {
      throw new Error('No response body received')
    }

    return response.body
  }

  /**
   * 获取 MIME 类型（根据 OpenAI TTS API 官方文档）
   * OpenAI 支持的格式：mp3, opus, aac, flac, wav, pcm
   */
  private getMimeType(format: string): string {
    switch (format.toLowerCase()) {
      case 'mp3':
        return 'audio/mpeg' // MP3 格式
      case 'opus':
        return 'audio/ogg; codecs=opus' // Opus 编码，适合流式传输
      case 'aac':
        return 'audio/aac' // AAC 格式，适合移动设备
      case 'flac':
        return 'audio/flac' // FLAC 无损压缩格式
      case 'wav':
        return 'audio/wav' // WAV 无压缩格式
      case 'pcm':
        return 'audio/wav' // PCM 原始 24kHz 采样，使用 WAV 容器
      default:
        return 'audio/mpeg' // 默认使用 MP3
    }
  }
}
