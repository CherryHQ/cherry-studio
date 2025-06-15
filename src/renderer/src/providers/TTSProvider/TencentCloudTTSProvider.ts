import { TENCENT_TTS_VOICES } from '@renderer/constants/tts'
import { TTSSpeakOptions, TTSVoice } from '@renderer/types/tts'

import { BaseTTSProvider, TTSCheckResult } from './BaseTTSProvider'

export class TencentCloudTTSProvider extends BaseTTSProvider {
  async getVoices(): Promise<TTSVoice[]> {
    if (!this.validateApiKey()) {
      console.warn('[Tencent Cloud TTS] No SecretId or SecretKey configured, using default voices')
      return this.getDefaultVoices()
    }

    try {
      // 腾讯云语音合成不提供获取语音列表的 API，使用预定义的语音列表

      return this.getDefaultVoices()
    } catch (error) {
      console.error('[Tencent Cloud TTS] Error:', error)
      return this.getDefaultVoices()
    }
  }

  /**
   * 获取默认语音列表（基于腾讯云官方音色列表）
   */
  private getDefaultVoices(): TTSVoice[] {
    return TENCENT_TTS_VOICES
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
        // 使用真正的流式合成
        const audioStream = await this.synthesizeSpeechStream(options)
        const mimeType = this.getMimeType(this.provider.settings.codec || 'pcm')
        const enablePause = this.provider.settings.pauseSupport ?? false
        await this.audioPlayer.playStream(audioStream, mimeType, volume, { enablePause })
      } else {
        // 使用基础语音合成
        const audioData = await this.synthesizeSpeech(options)
        const mimeType = this.getMimeType(this.provider.settings.codec || 'wav')
        const audioBlob = this.createBlobFromBase64(audioData, mimeType)
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

    try {
      const result = await window.api.tencentTTS.synthesizeSpeech(ttsOptions)

      if (result.success && result.audioData) {
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
   * 腾讯云流式语音合成 (WebSocket)
   */
  private async synthesizeSpeechStream(options: TTSSpeakOptions): Promise<ReadableStream<Uint8Array>> {
    const secretId = this.provider.apiKey!
    const secretKey = this.provider.settings.secretKey!
    const region = this.provider.settings.region || 'ap-beijing'

    return new ReadableStream({
      start: async (controller) => {
        try {
          const ws = await this.createStreamingConnection(secretId, secretKey, region, options)

          ws.onmessage = (event) => {
            if (event.data instanceof ArrayBuffer) {
              // 音频数据
              controller.enqueue(new Uint8Array(event.data))
            } else {
              // 文本消息
              try {
                const message = JSON.parse(event.data)
                if (message.final === 1) {
                  // 合成完成
                  ws.close()
                  controller.close()
                } else if (message.code !== 0) {
                  // 错误
                  console.error('[Tencent Cloud TTS] Streaming error:', message)
                  ws.close()
                  controller.error(new Error(message.message || 'Streaming synthesis failed'))
                }
              } catch (e) {
                console.warn('[Tencent Cloud TTS] Failed to parse message:', event.data)
              }
            }
          }

          ws.onerror = (error) => {
            console.error('[Tencent Cloud TTS] WebSocket error:', error)
            controller.error(new Error('WebSocket connection failed'))
          }

          ws.onclose = () => {
            controller.close()
          }

          // 等待 READY 事件后发送文本
          ws.onopen = () => {
            // WebSocket connection opened
          }
        } catch (error) {
          console.error('[Tencent Cloud TTS] Failed to create streaming connection:', error)
          controller.error(error)
        }
      }
    })
  }

  /**
   * 创建流式合成 WebSocket 连接
   */
  private async createStreamingConnection(
    secretId: string,
    secretKey: string,
    _region: string,
    options: TTSSpeakOptions
  ): Promise<WebSocket> {
    // 生成会话 ID
    const sessionId = this.generateSessionId()
    const timestamp = Math.floor(Date.now() / 1000)
    const expired = timestamp + 3600 // 1小时后过期

    // 构建请求参数
    const params: Record<string, any> = {
      Action: 'TextToStreamAudioWSv2',
      AppId: await this.getAppId(),
      SecretId: secretId,
      Timestamp: timestamp,
      Expired: expired,
      SessionId: sessionId,
      VoiceType: parseInt(options.voice || this.provider.settings.voice || '101001'),
      Volume: this.convertVolumeToGain(options.volume ?? this.provider.settings.volume ?? 1.0),
      Speed: this.convertRateToSpeed(options.rate ?? this.provider.settings.rate ?? 1.0),
      SampleRate: this.provider.settings.sampleRate || 16000,
      Codec: this.provider.settings.codec || 'pcm',
      EnableSubtitle: 'true' // 注意：文档示例中 Boolean 值使用字符串
    }

    // 添加可选参数
    const emotionCategory = (this.provider.settings as any).emotionCategory
    if (emotionCategory) {
      params.EmotionCategory = emotionCategory
      params.EmotionIntensity = (this.provider.settings as any).emotionIntensity || 100
    }

    const segmentRate = (this.provider.settings as any).segmentRate
    if (segmentRate !== undefined) {
      params.SegmentRate = segmentRate
    }

    // 生成签名
    const signature = await this.generateSignature(params, secretKey)
    params['Signature'] = signature

    // 构建 WebSocket URL (注意：签名后的参数需要 URL 编码)
    const queryString = Object.entries(params)
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join('&')

    const wsUrl = `wss://tts.cloud.tencent.com/stream_wsv2?${queryString}`

    const ws = new WebSocket(wsUrl)

    return new Promise((resolve, reject) => {
      let isReady = false

      ws.onopen = () => {
        // WebSocket opened, waiting for READY event
      }

      ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          try {
            const message = JSON.parse(event.data)

            if (message.code !== 0) {
              reject(new Error(message.message || 'Connection failed'))
              return
            }

            if (message.ready === 1 && !isReady) {
              isReady = true

              // 发送合成文本 (需要进行 Unicode 转义)
              const synthesisMessage = {
                session_id: sessionId,
                message_id: this.generateMessageId(),
                action: 'ACTION_SYNTHESIS',
                data: this.escapeUnicode(options.text)
              }
              ws.send(JSON.stringify(synthesisMessage))

              // 发送结束指令
              setTimeout(() => {
                const completeMessage = {
                  session_id: sessionId,
                  message_id: this.generateMessageId(),
                  action: 'ACTION_COMPLETE',
                  data: ''
                }
                ws.send(JSON.stringify(completeMessage))
              }, 100)

              resolve(ws)
            }
          } catch (e) {
            console.warn('[Tencent Cloud TTS] Failed to parse handshake message:', event.data)
          }
        }
      }

      ws.onerror = () => {
        reject(new Error('WebSocket connection failed'))
      }

      // 超时处理
      setTimeout(() => {
        if (!isReady) {
          ws.close()
          reject(new Error('Connection timeout'))
        }
      }, 10000)
    })
  }

  /**
   * 生成腾讯云 API 签名
   */
  private async generateSignature(params: Record<string, any>, secretKey: string): Promise<string> {
    // 排序参数 (按字典序排序，不包含 Signature)
    const sortedParams = Object.keys(params)
      .filter((key) => key !== 'Signature')
      .sort()
      .map((key) => `${key}=${params[key]}`) // 注意：这里不进行 URL 编码
      .join('&')

    // 构建签名原文 (注意格式：GET + 域名 + 路径 + ? + 参数)
    const stringToSign = `GETtts.cloud.tencent.com/stream_wsv2?${sortedParams}`

    // 使用 HMAC-SHA1 生成签名
    const encoder = new TextEncoder()
    const keyData = encoder.encode(secretKey)
    const messageData = encoder.encode(stringToSign)

    const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])

    const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData)
    const signatureBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)))

    return signatureBase64
  }

  /**
   * 获取 AppId (需要从腾讯云控制台获取)
   */
  private async getAppId(): Promise<number> {
    // 这里需要用户配置 AppId，暂时使用一个占位符
    // 在实际使用中，需要在设置页面添加 AppId 配置
    return (this.provider.settings as any).appId || 1300000000
  }

  /**
   * 生成会话 ID
   */
  private generateSessionId(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0
      const v = c === 'x' ? r : (r & 0x3) | 0x8
      return v.toString(16)
    })
  }

  /**
   * 生成消息 ID
   */
  private generateMessageId(): string {
    return 'msg-' + Date.now() + '-' + Math.random().toString(36).substring(2, 11)
  }

  /**
   * 将文本转换为 Unicode 转义格式
   */
  private escapeUnicode(text: string): string {
    return text.replace(/[\u0080-\uFFFF]/g, function (match) {
      return '\\u' + ('0000' + match.charCodeAt(0).toString(16)).substring(-4)
    })
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

  /**
   * 从 Base64 字符串创建 Blob（浏览器兼容方式）
   */
  private createBlobFromBase64(base64Data: string, mimeType: string): Blob {
    // 使用浏览器原生的 atob 函数解码 base64
    const binaryString = atob(base64Data)
    const bytes = new Uint8Array(binaryString.length)

    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }

    return new Blob([bytes], { type: mimeType })
  }
}
