import { TTSSpeakOptions, TTSVoice } from '@renderer/types/tts'

import { BaseTTSProvider, TTSCheckResult } from './BaseTTSProvider'

export class TencentCloudTTSProvider extends BaseTTSProvider {
  async getVoices(): Promise<TTSVoice[]> {
    try {
      const voices = await window.api.tencentTTS.getVoices()
      return voices.map((voice: any) => ({
        id: voice.id,
        name: voice.name,
        lang: voice.lang,
        gender: voice.gender,
        default: voice.default
      }))
    } catch (error) {
      console.error('[TencentCloudTTSProvider] Failed to get voices:', error)
      return []
    }
  }

  async speak(options: TTSSpeakOptions): Promise<void> {
    if (!this.validateApiKey()) {
      throw new Error('Tencent Cloud SecretId and SecretKey are required')
    }

    // 停止当前播放
    this.stop()

    try {
      const volume = options.volume ?? this.provider.settings.volume ?? 1.0
      const useStreaming = options.streaming ?? this.provider.settings.streaming ?? false

      if (useStreaming) {
        // 流式合成
        const audioStream = await this.synthesizeSpeechStream(options)
        const mimeType = this.getMimeType(this.provider.settings.codec || 'wav')
        await this.audioPlayer.playStream(audioStream, mimeType, volume)
      } else {
        // 非流式合成
        const audioData = await this.synthesizeSpeech(options)
        const audioBlob = new Blob([Buffer.from(audioData, 'base64')], { type: 'audio/wav' })
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
          error: new Error('Tencent Cloud SecretId and SecretKey are required')
        }
      }

      const secretId = this.provider.apiKey!
      const secretKey = this.provider.settings.secretKey!
      const region = this.provider.settings.region || 'ap-beijing'

      // 测试 API 连接
      const result = await window.api.tencentTTS.testConnection(secretId, secretKey, region)

      if (result.success) {
        return {
          valid: true,
          error: null
        }
      } else {
        return {
          valid: false,
          error: new Error(result.error || 'Tencent Cloud TTS API test failed')
        }
      }
    } catch (error) {
      return {
        valid: false,
        error: this.handleError(error)
      }
    }
  }

  protected getDefaultApiHost(): string {
    return 'tts.tencentcloudapi.com'
  }

  /**
   * 验证 API Key（腾讯云需要 SecretId 和 SecretKey）
   */
  protected validateApiKey(): boolean {
    const secretId = this.provider.apiKey
    const secretKey = this.provider.settings.secretKey
    return !!(secretId && secretKey)
  }

  /**
   * 调用腾讯云 TTS API 进行语音合成
   */
  private async synthesizeSpeech(options: TTSSpeakOptions): Promise<string> {
    const secretId = this.provider.apiKey
    const secretKey = this.provider.settings.secretKey
    const region = this.provider.settings.region || 'ap-beijing'

    if (!secretId || !secretKey) {
      throw new Error('Tencent Cloud SecretId and SecretKey are required')
    }

    const ttsOptions = {
      secretId,
      secretKey,
      region,
      text: options.text,
      voice: options.voice || this.provider.settings.voice || '101001',
      speed: this.convertRateToSpeed(options.rate ?? this.provider.settings.rate ?? 1.0),
      volume: this.convertVolumeToGain(options.volume ?? this.provider.settings.volume ?? 1.0),
      sampleRate: this.provider.settings.sampleRate || 16000,
      codec: this.provider.settings.codec || 'wav'
    }

    console.log('[TencentCloudTTSProvider] Synthesizing speech:', {
      voiceType: ttsOptions.voice,
      textLength: options.text.length,
      speed: ttsOptions.speed,
      volume: ttsOptions.volume,
      sampleRate: ttsOptions.sampleRate,
      codec: ttsOptions.codec
    })

    try {
      const result = await window.api.tencentTTS.synthesizeSpeech(ttsOptions)

      if (result.success && result.audioData) {
        console.log('[TencentCloudTTSProvider] Speech synthesis successful')
        return result.audioData
      } else {
        throw new Error(result.error || 'No audio data returned from Tencent Cloud TTS API')
      }
    } catch (error: any) {
      console.error('[TencentCloudTTSProvider] API Error:', error)
      throw new Error(`Tencent Cloud TTS API error: ${error.message || error}`)
    }
  }

  /**
   * 调用腾讯云 TTS API 流式合成语音
   */
  private async synthesizeSpeechStream(options: TTSSpeakOptions): Promise<ReadableStream<Uint8Array>> {
    const secretId = this.provider.apiKey
    const secretKey = this.provider.settings.secretKey
    const region = this.provider.settings.region || 'ap-beijing'

    if (!secretId || !secretKey) {
      throw new Error('Tencent Cloud SecretId and SecretKey are required')
    }

    const ttsOptions = {
      secretId,
      secretKey,
      region,
      text: options.text,
      voice: options.voice || this.provider.settings.voice || '101001',
      speed: this.convertRateToSpeed(options.rate ?? this.provider.settings.rate ?? 1.0),
      volume: this.convertVolumeToGain(options.volume ?? this.provider.settings.volume ?? 1.0),
      sampleRate: this.provider.settings.sampleRate || 16000,
      codec: this.provider.settings.codec || 'wav',
      streaming: true
    }

    console.log('[TencentCloudTTSProvider] Streaming speech synthesis:', {
      voiceType: ttsOptions.voice,
      textLength: options.text.length,
      speed: ttsOptions.speed,
      volume: ttsOptions.volume,
      sampleRate: ttsOptions.sampleRate,
      codec: ttsOptions.codec
    })

    try {
      // 暂时回退到非流式模式，然后转换为流式
      // TODO: 实现真正的腾讯云 WebSocket 流式 TTS
      const result = await window.api.tencentTTS.synthesizeSpeech({
        secretId: ttsOptions.secretId,
        secretKey: ttsOptions.secretKey,
        region: ttsOptions.region,
        text: ttsOptions.text,
        voice: ttsOptions.voice,
        speed: ttsOptions.speed,
        volume: ttsOptions.volume,
        sampleRate: ttsOptions.sampleRate,
        codec: ttsOptions.codec
      })

      if (result.success && result.audioData) {
        console.log('[TencentCloudTTSProvider] Streaming speech synthesis successful (fallback to non-streaming)')
        // 将 Base64 数据转换为 ReadableStream
        return this.createStreamFromBase64(result.audioData)
      } else {
        throw new Error(result.error || 'No audio data returned from Tencent Cloud TTS API')
      }
    } catch (error: any) {
      console.error('[TencentCloudTTSProvider] Streaming API Error:', error)
      throw new Error(`Tencent Cloud TTS streaming API error: ${error.message || error}`)
    }
  }

  /**
   * 将 Base64 数据流转换为 ReadableStream
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
   * 将语速比率转换为腾讯云的速度值
   * 腾讯云速度范围：-2 到 6，0 为正常速度（根据官方文档更新）
   * -2: 0.6倍速度, -1: 0.8倍速度, 0: 1.0倍速度, 1: 1.2倍速度, ..., 6: 2.5倍速度
   */
  private convertRateToSpeed(rate: number): number {
    // rate 范围通常是 0.25 - 4.0
    // 转换为腾讯云的 -2 到 6 范围
    if (rate <= 0.6) return -2 // 0.6倍速度
    if (rate <= 0.8) return -1 // 0.8倍速度
    if (rate <= 1.1) return 0 // 1.0倍速度
    if (rate <= 1.3) return 1 // 1.2倍速度
    if (rate <= 1.5) return 2 // 1.5倍速度
    if (rate <= 1.8) return 3 // 1.8倍速度
    if (rate <= 2.0) return 4 // 2.0倍速度
    if (rate <= 2.2) return 5 // 2.2倍速度
    return 6 // 2.5倍速度
  }

  /**
   * 将音量比率转换为腾讯云的音量值
   * 腾讯云音量范围：-10 到 10，0 为正常音量
   */
  private convertVolumeToGain(volume: number): number {
    // volume 范围通常是 0.0 - 1.0
    // 转换为腾讯云的 -10 到 10 范围
    return Math.round((volume - 0.5) * 20)
  }

  /**
   * 获取 MIME 类型
   */
  private getMimeType(format: string): string {
    switch (format.toLowerCase()) {
      case 'wav':
        return 'audio/wav'
      case 'mp3':
        return 'audio/mpeg'
      case 'pcm':
        return 'audio/wav' // PCM 通常在 WAV 容器中
      case 'opus':
        return 'audio/ogg; codecs=opus'
      case 'ogg':
        return 'audio/ogg'
      default:
        return 'audio/wav' // 默认使用 WAV
    }
  }
}
