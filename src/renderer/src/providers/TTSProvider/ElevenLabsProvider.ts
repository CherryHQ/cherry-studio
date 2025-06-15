import { TTSSpeakOptions, TTSVoice } from '@renderer/types/tts'

import { BaseTTSProvider, TTSCheckResult } from './BaseTTSProvider'

export class ElevenLabsProvider extends BaseTTSProvider {
  async getVoices(): Promise<TTSVoice[]> {
    if (!this.validateApiKey()) {
      return this.getDefaultVoices()
    }

    try {
      const response = await fetch(`${this.getApiHost()}/v1/voices`, {
        method: 'GET',
        headers: {
          'xi-api-key': this.provider.apiKey!
        }
      })

      if (!response.ok) {
        console.error('Failed to fetch ElevenLabs voices:', response.statusText)
        return this.getDefaultVoices()
      }

      const data = await response.json()
      return data.voices.map((voice: any) => ({
        id: voice.voice_id,
        name: voice.name,
        lang: voice.labels?.language || 'en',
        gender: voice.labels?.gender || 'neutral'
      }))
    } catch (error) {
      console.error('Error fetching ElevenLabs voices:', error)
      return this.getDefaultVoices()
    }
  }

  async speak(options: TTSSpeakOptions): Promise<void> {
    if (!this.validateApiKey()) {
      throw new Error('ElevenLabs API key is required')
    }

    // 停止当前播放
    this.stop()

    try {
      const volume = options.volume ?? this.provider.settings.volume ?? 1.0
      const useStreaming = options.streaming ?? this.provider.settings.streaming ?? false

      if (useStreaming) {
        // 流式合成
        const audioStream = await this.synthesizeSpeechStream(options)
        const mimeType = this.getMimeType('mp3') // ElevenLabs 默认返回 MP3 格式
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
          error: new Error('ElevenLabs API key is required')
        }
      }

      // 测试 API 连接
      const response = await fetch(`${this.getApiHost()}/v1/user`, {
        method: 'GET',
        headers: {
          'xi-api-key': this.provider.apiKey!
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
    return 'https://api.elevenlabs.io'
  }

  /**
   * 获取默认语音列表（当 API 调用失败时使用）
   */
  private getDefaultVoices(): TTSVoice[] {
    return [
      { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella', lang: 'en', gender: 'female' },
      { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni', lang: 'en', gender: 'male' },
      { id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli', lang: 'en', gender: 'female' },
      { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh', lang: 'en', gender: 'male' },
      { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold', lang: 'en', gender: 'male' },
      { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', lang: 'en', gender: 'male' }
    ]
  }

  /**
   * 调用 ElevenLabs API 合成语音
   */
  private async synthesizeSpeech(options: TTSSpeakOptions): Promise<Blob> {
    const voiceId = options.voice || this.provider.settings.voice || 'EXAVITQu4vr4xnSDxMaL'

    const requestBody = {
      text: options.text,
      model_id: this.provider.settings.model || 'eleven_multilingual_v2',
      voice_settings: {
        stability: this.provider.settings.stability ?? 0.5,
        similarity_boost: this.provider.settings.similarity_boost ?? 0.5,
        style: this.provider.settings.style ?? 0.0,
        use_speaker_boost: this.provider.settings.use_speaker_boost ?? true
      }
    }

    const response = await fetch(`${this.getApiHost()}/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        Accept: 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': this.provider.apiKey!
      },
      body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`ElevenLabs API error: ${response.status} ${errorText}`)
    }

    return await response.blob()
  }

  /**
   * 调用 ElevenLabs API 流式合成语音
   */
  private async synthesizeSpeechStream(options: TTSSpeakOptions): Promise<ReadableStream<Uint8Array>> {
    const voiceId = options.voice || this.provider.settings.voice || 'EXAVITQu4vr4xnSDxMaL'

    const requestBody = {
      text: options.text,
      model_id: this.provider.settings.model || 'eleven_multilingual_v2',
      voice_settings: {
        stability: this.provider.settings.stability ?? 0.5,
        similarity_boost: this.provider.settings.similarity_boost ?? 0.5,
        style: this.provider.settings.style ?? 0.0,
        use_speaker_boost: this.provider.settings.use_speaker_boost ?? true
      },
      stream: true
    }

    const response = await fetch(`${this.getApiHost()}/v1/text-to-speech/${voiceId}/stream`, {
      method: 'POST',
      headers: {
        Accept: 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': this.provider.apiKey!
      },
      body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`ElevenLabs streaming API error: ${response.status} ${errorText}`)
    }

    if (!response.body) {
      throw new Error('No response body received')
    }

    return response.body
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
      case 'flac':
        return 'audio/flac'
      case 'aac':
        return 'audio/aac'
      default:
        return 'audio/mpeg' // 默认使用 MP3
    }
  }
}
