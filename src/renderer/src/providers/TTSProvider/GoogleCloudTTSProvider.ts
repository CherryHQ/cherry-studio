import { TTSSpeakOptions, TTSVoice } from '@renderer/types/tts'

import { BaseTTSProvider, TTSCheckResult } from './BaseTTSProvider'

export class GoogleCloudTTSProvider extends BaseTTSProvider {
  async getVoices(): Promise<TTSVoice[]> {
    try {
      const apiKey = this.provider.apiKey
      if (!apiKey) {
        console.warn('[GoogleCloudTTSProvider] No API key provided')
        return this.getDefaultVoices()
      }

      // 调用 Google Cloud TTS API 获取语音列表
      const response = await fetch(`https://texttospeech.googleapis.com/v1/voices?key=${apiKey}`)

      if (!response.ok) {
        console.error('[GoogleCloudTTSProvider] Failed to fetch voices:', response.statusText)
        return this.getDefaultVoices()
      }

      const data = await response.json()

      if (data.voices && Array.isArray(data.voices)) {
        return data.voices.map((voice: any) => ({
          id: voice.name,
          name: `${voice.name} (${voice.languageCodes[0]})`,
          lang: voice.languageCodes[0],
          gender: voice.ssmlGender?.toLowerCase() || 'neutral',
          default: voice.name === 'en-US-Wavenet-D'
        }))
      }

      return this.getDefaultVoices()
    } catch (error) {
      console.error('[GoogleCloudTTSProvider] Failed to get voices:', error)
      return this.getDefaultVoices()
    }
  }

  private getDefaultVoices(): TTSVoice[] {
    return [
      // 英文语音
      {
        id: 'en-US-Wavenet-D',
        name: 'en-US-Wavenet-D (English US, Male)',
        lang: 'en-US',
        gender: 'male',
        default: true
      },
      {
        id: 'en-US-Wavenet-C',
        name: 'en-US-Wavenet-C (English US, Female)',
        lang: 'en-US',
        gender: 'female',
        default: false
      },
      {
        id: 'en-US-Wavenet-A',
        name: 'en-US-Wavenet-A (English US, Male)',
        lang: 'en-US',
        gender: 'male',
        default: false
      },
      {
        id: 'en-US-Wavenet-B',
        name: 'en-US-Wavenet-B (English US, Male)',
        lang: 'en-US',
        gender: 'male',
        default: false
      },
      {
        id: 'en-US-Wavenet-E',
        name: 'en-US-Wavenet-E (English US, Female)',
        lang: 'en-US',
        gender: 'female',
        default: false
      },
      {
        id: 'en-US-Wavenet-F',
        name: 'en-US-Wavenet-F (English US, Female)',
        lang: 'en-US',
        gender: 'female',
        default: false
      },

      // 中文语音
      {
        id: 'cmn-CN-Wavenet-A',
        name: 'cmn-CN-Wavenet-A (Chinese, Female)',
        lang: 'cmn-CN',
        gender: 'female',
        default: false
      },
      {
        id: 'cmn-CN-Wavenet-B',
        name: 'cmn-CN-Wavenet-B (Chinese, Male)',
        lang: 'cmn-CN',
        gender: 'male',
        default: false
      },
      {
        id: 'cmn-CN-Wavenet-C',
        name: 'cmn-CN-Wavenet-C (Chinese, Male)',
        lang: 'cmn-CN',
        gender: 'male',
        default: false
      },
      {
        id: 'cmn-CN-Wavenet-D',
        name: 'cmn-CN-Wavenet-D (Chinese, Female)',
        lang: 'cmn-CN',
        gender: 'female',
        default: false
      },

      // 日文语音
      {
        id: 'ja-JP-Wavenet-A',
        name: 'ja-JP-Wavenet-A (Japanese, Female)',
        lang: 'ja-JP',
        gender: 'female',
        default: false
      },
      {
        id: 'ja-JP-Wavenet-B',
        name: 'ja-JP-Wavenet-B (Japanese, Female)',
        lang: 'ja-JP',
        gender: 'female',
        default: false
      },
      {
        id: 'ja-JP-Wavenet-C',
        name: 'ja-JP-Wavenet-C (Japanese, Male)',
        lang: 'ja-JP',
        gender: 'male',
        default: false
      },
      {
        id: 'ja-JP-Wavenet-D',
        name: 'ja-JP-Wavenet-D (Japanese, Male)',
        lang: 'ja-JP',
        gender: 'male',
        default: false
      },

      // 其他语言
      {
        id: 'fr-FR-Wavenet-A',
        name: 'fr-FR-Wavenet-A (French, Female)',
        lang: 'fr-FR',
        gender: 'female',
        default: false
      },
      {
        id: 'de-DE-Wavenet-A',
        name: 'de-DE-Wavenet-A (German, Female)',
        lang: 'de-DE',
        gender: 'female',
        default: false
      },
      {
        id: 'es-ES-Wavenet-A',
        name: 'es-ES-Wavenet-A (Spanish, Female)',
        lang: 'es-ES',
        gender: 'female',
        default: false
      },
      {
        id: 'it-IT-Wavenet-A',
        name: 'it-IT-Wavenet-A (Italian, Female)',
        lang: 'it-IT',
        gender: 'female',
        default: false
      }
    ]
  }

  async speak(options: TTSSpeakOptions): Promise<void> {
    try {
      // 停止当前播放
      this.stop()

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
        const audioData = await this.synthesizeSpeech(options)
        const mimeType = this.getMimeType(this.provider.settings.format || 'mp3')
        await this.audioPlayer.playBase64(audioData, mimeType, volume)
      }
    } catch (error) {
      console.error('[GoogleCloudTTSProvider] Speech failed:', error)
      throw error
    }
  }

  protected getDefaultApiHost(): string {
    return 'texttospeech.googleapis.com'
  }

  async check(): Promise<TTSCheckResult> {
    try {
      if (!this.validateApiKey()) {
        return {
          valid: false,
          error: new Error('Google Cloud API key is required')
        }
      }

      // 测试 API 连接
      const testResult = await this.synthesizeSpeech({
        text: 'test',
        voice: 'en-US-Wavenet-D',
        rate: 1.0,
        volume: 1.0
      })

      if (testResult) {
        return {
          valid: true,
          error: null
        }
      } else {
        return {
          valid: false,
          error: new Error('Google Cloud TTS API test failed')
        }
      }
    } catch (error) {
      return {
        valid: false,
        error: this.handleError(error)
      }
    }
  }

  /**
   * 调用 Google Cloud TTS API 进行语音合成
   */
  private async synthesizeSpeech(options: TTSSpeakOptions): Promise<string> {
    const apiKey = this.provider.apiKey
    if (!apiKey) {
      throw new Error('Google Cloud API key is required')
    }

    const requestBody = {
      input: this.createSynthesisInput(options.text),
      voice: {
        languageCode: this.getLanguageCode(options.voice || this.provider.settings.voice || 'en-US-Wavenet-D'),
        name: options.voice || this.provider.settings.voice || 'en-US-Wavenet-D',
        ssmlGender: this.getSSMLGender(options.voice || this.provider.settings.voice || 'en-US-Wavenet-D')
      },
      audioConfig: {
        audioEncoding: this.getAudioEncoding(this.provider.settings.format || 'mp3'),
        speakingRate: options.rate ?? this.provider.settings.rate ?? 1.0,
        pitch: this.convertPitchToSemitones(options.pitch ?? this.provider.settings.pitch ?? 1.0),
        volumeGainDb: this.convertVolumeToGain(options.volume ?? this.provider.settings.volume ?? 1.0),
        sampleRateHertz: this.provider.settings.sampleRate || 24000
      }
    }

    try {
      const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(
          `Google Cloud TTS API error: ${response.status} ${response.statusText} - ${errorData.error?.message || 'Unknown error'}`
        )
      }

      const data = await response.json()

      if (data.audioContent) {
        return data.audioContent
      } else {
        throw new Error('No audio content returned from Google Cloud TTS API')
      }
    } catch (error: any) {
      console.error('[GoogleCloudTTSProvider] API Error:', error)
      throw new Error(`Google Cloud TTS API error: ${error.message || error}`)
    }
  }

  /**
   * 调用 Google Cloud TTS API 流式合成语音
   */
  private async synthesizeSpeechStream(options: TTSSpeakOptions): Promise<ReadableStream<Uint8Array>> {
    const apiKey = this.provider.apiKey
    if (!apiKey) {
      throw new Error('Google Cloud API key is required')
    }

    const requestBody = {
      input: this.createSynthesisInput(options.text),
      voice: {
        languageCode: this.getLanguageCode(options.voice || this.provider.settings.voice || 'en-US-Wavenet-D'),
        name: options.voice || this.provider.settings.voice || 'en-US-Wavenet-D',
        ssmlGender: this.getSSMLGender(options.voice || this.provider.settings.voice || 'en-US-Wavenet-D')
      },
      audioConfig: {
        audioEncoding: this.getAudioEncoding(this.provider.settings.format || 'mp3'),
        speakingRate: options.rate ?? this.provider.settings.rate ?? 1.0,
        pitch: this.convertPitchToSemitones(options.pitch ?? this.provider.settings.pitch ?? 1.0),
        volumeGainDb: this.convertVolumeToGain(options.volume ?? this.provider.settings.volume ?? 1.0),
        sampleRateHertz: this.provider.settings.sampleRate || 24000
      }
    }

    try {
      // Google Cloud TTS 目前不支持真正的流式合成，所以我们先获取完整音频然后模拟流式
      const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(
          `Google Cloud TTS streaming API error: ${response.status} ${response.statusText} - ${errorData.error?.message || 'Unknown error'}`
        )
      }

      const data = await response.json()

      if (data.audioContent) {
        // 将 Base64 数据转换为 ReadableStream
        return this.createStreamFromBase64(data.audioContent)
      } else {
        throw new Error('No audio content returned from Google Cloud TTS API')
      }
    } catch (error: any) {
      console.error('[GoogleCloudTTSProvider] Streaming API Error:', error)
      throw new Error(`Google Cloud TTS streaming API error: ${error.message || error}`)
    }
  }

  /**
   * 将 Base64 数据转换为 ReadableStream
   */
  private createStreamFromBase64(base64Data: string): ReadableStream<Uint8Array> {
    const binaryData = Buffer.from(base64Data, 'base64')

    return new ReadableStream({
      start(controller) {
        // 将数据分块发送
        const chunkSize = 1024 * 4 // 4KB 块
        let offset = 0

        const sendChunk = () => {
          if (offset < binaryData.length) {
            const chunk = binaryData.subarray(offset, offset + chunkSize)
            controller.enqueue(chunk)
            offset += chunkSize
            // 模拟流式传输的延迟
            setTimeout(sendChunk, 50)
          } else {
            controller.close()
          }
        }

        sendChunk()
      }
    })
  }

  /**
   * 从语音名称获取语言代码
   */
  private getLanguageCode(voiceName: string): string {
    if (voiceName.startsWith('en-US')) return 'en-US'
    if (voiceName.startsWith('cmn-CN')) return 'cmn-CN'
    if (voiceName.startsWith('ja-JP')) return 'ja-JP'
    if (voiceName.startsWith('fr-FR')) return 'fr-FR'
    if (voiceName.startsWith('de-DE')) return 'de-DE'
    if (voiceName.startsWith('es-ES')) return 'es-ES'
    if (voiceName.startsWith('it-IT')) return 'it-IT'
    return 'en-US' // 默认
  }

  /**
   * 从语音名称获取 SSML 性别
   */
  private getSSMLGender(voiceName: string): string {
    // 根据 Google Cloud TTS 的命名规则推断性别
    // 这是一个简化的实现，实际应该从 API 获取
    const femaleVoices = ['A', 'C', 'E', 'F']
    const lastChar = voiceName.slice(-1)
    return femaleVoices.includes(lastChar) ? 'FEMALE' : 'MALE'
  }

  /**
   * 创建合成输入（支持 SSML 和纯文本）
   */
  private createSynthesisInput(text: string): { text?: string; ssml?: string } {
    // 检查是否为 SSML 格式（以 <speak> 开头并以 </speak> 结尾）
    const isSSML = text.trim().startsWith('<speak>') && text.trim().endsWith('</speak>')

    if (isSSML) {
      return { ssml: text }
    } else {
      return { text: text }
    }
  }

  /**
   * 获取 MIME 类型（根据 Google Cloud TTS API 官方文档）
   * Google Cloud 支持的格式：LINEAR16, MP3, OGG_OPUS, MULAW, ALAW
   * 流式支持：PCM, ALAW, MULAW, OGG_OPUS
   */
  private getMimeType(format: string): string {
    switch (format.toLowerCase()) {
      case 'mp3':
        return 'audio/mpeg' // MP3 格式，32kbps
      case 'wav':
      case 'linear16':
        return 'audio/wav' // LINEAR16 非压缩 16 位符号小端序采样
      case 'ogg':
      case 'opus':
      case 'ogg_opus':
        return 'audio/ogg; codecs=opus' // Opus 编码音频，支持流式
      case 'mulaw':
        return 'audio/wav' // MULAW 8 位 编码，在 WAV 容器中
      case 'alaw':
        return 'audio/wav' // ALAW 8 位 编码，在 WAV 容器中
      case 'pcm':
        return 'audio/wav' // PCM 原始音频数据，使用 WAV 容器
      default:
        return 'audio/mpeg' // 默认使用 MP3
    }
  }

  /**
   * 获取 Google Cloud 的音频编码格式
   */
  private getAudioEncoding(format: string): string {
    switch (format.toLowerCase()) {
      case 'mp3':
        return 'MP3'
      case 'wav':
      case 'linear16':
        return 'LINEAR16'
      case 'ogg':
      case 'opus':
      case 'ogg_opus':
        return 'OGG_OPUS'
      case 'mulaw':
        return 'MULAW'
      case 'alaw':
        return 'ALAW'
      case 'pcm':
        return 'LINEAR16' // PCM 使用 LINEAR16 编码
      default:
        return 'MP3' // 默认使用 MP3
    }
  }

  /**
   * 将音调比例转换为 Google Cloud 的半音值
   * Google Cloud 音调范围：-20.0 到 20.0 半音
   */
  private convertPitchToSemitones(pitch: number): number {
    // pitch 范围通常是 0.0 - 2.0，1.0 为正常
    // 转换为 Google Cloud 的 -20.0 到 20.0 半音范围
    if (pitch <= 0) return -20.0
    if (pitch >= 2.0) return 20.0

    // 线性映射：1.0 -> 0半音, 2.0 -> 20半音, 0.0 -> -20半音
    return (pitch - 1.0) * 20
  }

  /**
   * 将音量比例转换为 Google Cloud 的增益值
   * Google Cloud 音量范围：-96.0 到 16.0 dB
   */
  private convertVolumeToGain(volume: number): number {
    // volume 范围通常是 0.0 - 2.0
    // 转换为 Google Cloud 的 -96.0 到 16.0 dB 范围
    if (volume <= 0) return -96.0
    if (volume >= 2.0) return 16.0

    // 线性映射：1.0 -> 0dB, 2.0 -> 16dB, 0.5 -> -20dB
    return (volume - 1.0) * 20
  }
}
