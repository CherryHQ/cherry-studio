import { AZURE_TTS_DEFAULT_VOICES } from '@renderer/constants/tts'
import { TTSSpeakOptions, TTSVoice } from '@renderer/types/tts'

import { BaseTTSProvider, TTSCheckResult } from './BaseTTSProvider'

export class AzureTTSProvider extends BaseTTSProvider {
  async getVoices(): Promise<TTSVoice[]> {
    if (!this.validateApiKey()) {
      console.warn('[Azure TTS] No API key configured, using default voices')
      return this.getDefaultVoices()
    }

    const apiHost = this.getApiHost()
    const endpoint = `${apiHost}/cognitiveservices/voices/list`

    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          'Ocp-Apim-Subscription-Key': this.provider.apiKey!
        }
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('[Azure TTS] API Error:', {
          status: response.status,
          statusText: response.statusText,
          endpoint: endpoint,
          region: this.provider.settings.region,
          errorBody: errorText
        })
        return this.getDefaultVoices()
      }

      const voices = await response.json()

      return voices.map((voice: any) => ({
        id: voice.ShortName,
        name: voice.DisplayName,
        lang: voice.Locale,
        gender: voice.Gender?.toLowerCase() || 'neutral'
      }))
    } catch (error) {
      console.error('[Azure TTS] Network error:', {
        error: error,
        endpoint: endpoint,
        region: this.provider.settings.region
      })
      return this.getDefaultVoices()
    }
  }

  async speak(options: TTSSpeakOptions): Promise<void> {
    if (!this.validateApiKey()) {
      throw new Error('Azure Speech API key is required')
    }

    // 停止当前播放
    this.stop()

    try {
      const volume = options.volume ?? this.provider.settings.volume ?? 1.0
      const useStreaming = options.streaming ?? this.provider.settings.streaming ?? false

      if (useStreaming) {
        // 流式合成
        const audioStream = await this.synthesizeSpeechStream(options)
        const mimeType = this.getMimeType('mp3') // Azure 默认返回 MP3 格式
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
          error: new Error('Azure Speech API key is required')
        }
      }

      // 测试 API 连接
      const response = await fetch(`${this.getApiHost()}/cognitiveservices/voices/list`, {
        method: 'GET',
        headers: {
          'Ocp-Apim-Subscription-Key': this.provider.apiKey!
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
    const region = this.provider.settings.region || 'eastus'
    return `https://${region}.tts.speech.microsoft.com`
  }

  /**
   * 获取默认语音列表（当 API 调用失败时使用）
   */
  private getDefaultVoices(): TTSVoice[] {
    return AZURE_TTS_DEFAULT_VOICES
  }

  /**
   * 调用 Azure Speech API 合成语音
   */
  private async synthesizeSpeech(options: TTSSpeakOptions): Promise<Blob> {
    const voice = options.voice || this.provider.settings.voice || 'en-US-AriaNeural'
    const rate = options.rate ?? this.provider.settings.rate
    const pitch = options.pitch ?? this.provider.settings.pitch

    // 构建 SSML
    const ssml = `
      <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">
        <voice name="${voice}">
          <prosody rate="${this.formatRate(rate)}" pitch="${this.formatPitch(pitch)}">
            ${this.escapeXml(options.text)}
          </prosody>
        </voice>
      </speak>
    `.trim()

    const response = await fetch(`${this.getApiHost()}/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': this.provider.apiKey!,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3'
      },
      body: ssml
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Azure Speech API error: ${response.status} ${errorText}`)
    }

    return await response.blob()
  }

  /**
   * 调用 Azure Speech API 流式合成语音
   */
  private async synthesizeSpeechStream(options: TTSSpeakOptions): Promise<ReadableStream<Uint8Array>> {
    const voice = options.voice || this.provider.settings.voice || 'en-US-AriaNeural'
    const rate = options.rate ?? this.provider.settings.rate
    const pitch = options.pitch ?? this.provider.settings.pitch

    // 构建 SSML
    const ssml = `
      <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">
        <voice name="${voice}">
          <prosody rate="${this.formatRate(rate)}" pitch="${this.formatPitch(pitch)}">
            ${this.escapeXml(options.text)}
          </prosody>
        </voice>
      </speak>
    `.trim()

    const response = await fetch(`${this.getApiHost()}/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': this.provider.apiKey!,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3'
      },
      body: ssml
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Azure Speech streaming API error: ${response.status} ${errorText}`)
    }

    if (!response.body) {
      throw new Error('No response body received')
    }

    return response.body
  }

  /**
   * 格式化语速为 Azure 支持的格式
   */
  private formatRate(rate: number): string {
    // Azure 支持的格式：x-slow, slow, medium, fast, x-fast 或百分比
    if (rate <= 0.5) return 'x-slow'
    if (rate <= 0.75) return 'slow'
    if (rate <= 1.25) return 'medium'
    if (rate <= 1.5) return 'fast'
    if (rate > 1.5) return 'x-fast'
    return `${Math.round(rate * 100)}%`
  }

  /**
   * 格式化音调为 Azure 支持的格式
   */
  private formatPitch(pitch: number): string {
    // Azure 支持的格式：x-low, low, medium, high, x-high 或相对值
    if (pitch <= 0.5) return 'x-low'
    if (pitch <= 0.75) return 'low'
    if (pitch <= 1.25) return 'medium'
    if (pitch <= 1.5) return 'high'
    if (pitch > 1.5) return 'x-high'
    return `${Math.round((pitch - 1) * 50)}%`
  }

  /**
   * 转义 XML 特殊字符
   */
  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
  }

  /**
   * 获取 MIME 类型
   */
  private getMimeType(format: string): string {
    switch (format.toLowerCase()) {
      case 'mp3':
        return 'audio/mpeg' // 正确的 MP3 MIME 类型
      case 'wav':
      case 'pcm':
        return 'audio/wav'
      case 'opus':
        return 'audio/ogg; codecs=opus'
      case 'ogg':
        return 'audio/ogg'
      case 'webm':
        return 'audio/webm'
      default:
        return 'audio/mpeg' // 默认使用 MP3
    }
  }
}
