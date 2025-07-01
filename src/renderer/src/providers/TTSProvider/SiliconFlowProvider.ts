import { SILICONFLOW_TTS_VOICES } from '@renderer/constants/tts'
import { TTSSpeakOptions, TTSVoice } from '@renderer/types/tts'

import { BaseTTSProvider, TTSCheckResult } from './BaseTTSProvider'

export class SiliconFlowProvider extends BaseTTSProvider {
  async getVoices(): Promise<TTSVoice[]> {
    // 硅基流动的系统预置音色
    return SILICONFLOW_TTS_VOICES
  }

  async speak(options: TTSSpeakOptions): Promise<void> {
    if (!this.validateApiKey()) {
      throw new Error('SiliconFlow API key is required')
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
          error: new Error('SiliconFlow API key is required')
        }
      }

      // 测试 API 连接
      const testResponse = await fetch(`${this.getApiHost()}/audio/speech`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.provider.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.provider.settings.model || 'FunAudioLLM/CosyVoice2-0.5B',
          voice: `${this.provider.settings.model || 'FunAudioLLM/CosyVoice2-0.5B'}:alex`,
          input: 'test',
          response_format: 'mp3'
        })
      })

      if (testResponse.ok) {
        return {
          valid: true,
          error: null
        }
      } else {
        const errorText = await testResponse.text()
        return {
          valid: false,
          error: new Error(`SiliconFlow API error: ${testResponse.status} ${errorText}`)
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
    return 'https://api.siliconflow.cn/v1'
  }

  /**
   * 调用硅基流动 API 进行语音合成
   */
  private async synthesizeSpeech(options: TTSSpeakOptions): Promise<Blob> {
    const model = this.provider.settings.model || 'FunAudioLLM/CosyVoice2-0.5B'

    // 构建语音参数
    let voice = options.voice || this.provider.settings.voice
    if (voice && !voice.includes(':')) {
      // 如果语音不包含模型前缀，自动添加
      voice = `${model}:${voice}`
    }

    const requestBody: any = {
      model,
      input: options.text,
      voice: voice || `${model}:alex`, // 默认使用 alex 音色
      response_format: this.provider.settings.format || 'mp3',
      speed: options.rate ?? this.provider.settings.rate ?? 1.0
    }

    // 添加音量控制（转换为 gain）
    if (options.volume !== undefined || this.provider.settings.volume !== undefined) {
      const volume = options.volume ?? this.provider.settings.volume ?? 1.0
      // 将 0-1 的音量转换为 -10 到 +10 的 gain
      const gain = (volume - 1.0) * 10
      requestBody.gain = Math.max(-10, Math.min(10, gain))
    }

    // 添加采样率控制
    if (this.provider.settings.sample_rate) {
      requestBody.sample_rate = this.provider.settings.sample_rate
    }

    const response = await fetch(`${this.getApiHost()}/audio/speech`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.provider.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`SiliconFlow API error: ${response.status} ${errorText}`)
    }

    return await response.blob()
  }

  /**
   * 调用硅基流动 API 流式合成语音
   */
  private async synthesizeSpeechStream(options: TTSSpeakOptions): Promise<ReadableStream<Uint8Array>> {
    const model = this.provider.settings.model || 'FunAudioLLM/CosyVoice2-0.5B'

    // 构建语音参数
    let voice = options.voice || this.provider.settings.voice
    if (voice && !voice.includes(':')) {
      // 如果语音不包含模型前缀，自动添加
      voice = `${model}:${voice}`
    }

    const requestBody: any = {
      model,
      input: options.text,
      voice: voice || `${model}:alex`, // 默认使用 alex 音色
      response_format: this.provider.settings.format || 'mp3',
      speed: options.rate ?? this.provider.settings.rate ?? 1.0,
      stream: true // 启用流式输出
    }

    // 添加音量控制（转换为 gain）
    if (options.volume !== undefined || this.provider.settings.volume !== undefined) {
      const volume = options.volume ?? this.provider.settings.volume ?? 1.0
      // 将 0-1 的音量转换为 -10 到 +10 的 gain
      const gain = (volume - 1.0) * 10
      requestBody.gain = Math.max(-10, Math.min(10, gain))
    }

    // 添加采样率控制
    if (this.provider.settings.sample_rate) {
      requestBody.sample_rate = this.provider.settings.sample_rate
    }

    const response = await fetch(`${this.getApiHost()}/audio/speech`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.provider.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`SiliconFlow streaming API error: ${response.status} ${errorText}`)
    }

    if (!response.body) {
      throw new Error('No response body received from SiliconFlow streaming API')
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
