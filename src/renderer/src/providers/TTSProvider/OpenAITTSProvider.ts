import { TTSSpeakOptions, TTSVoice } from '@renderer/types/tts'

import { BaseTTSProvider, TTSCheckResult } from './BaseTTSProvider'

export class OpenAITTSProvider extends BaseTTSProvider {
  async getVoices(): Promise<TTSVoice[]> {
    // OpenAI TTS 的固定语音列表
    return [
      { id: 'alloy', name: 'Alloy', lang: 'en-US', gender: 'neutral' },
      { id: 'echo', name: 'Echo', lang: 'en-US', gender: 'male' },
      { id: 'fable', name: 'Fable', lang: 'en-US', gender: 'neutral' },
      { id: 'onyx', name: 'Onyx', lang: 'en-US', gender: 'male' },
      { id: 'nova', name: 'Nova', lang: 'en-US', gender: 'female' },
      { id: 'shimmer', name: 'Shimmer', lang: 'en-US', gender: 'female' }
    ]
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
        await this.audioPlayer.playStream(audioStream, 'audio/mp3', volume)
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
    const voice = options.voice || this.provider.settings.voice || 'alloy'
    const speed = options.rate ?? this.provider.settings.rate

    const response = await fetch(`${this.getApiHost()}/v1/audio/speech`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.provider.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.provider.settings.model || 'tts-1', // 支持 tts-1 和 tts-1-hd
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
}
