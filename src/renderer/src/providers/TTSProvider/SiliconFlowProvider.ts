import { TTSSpeakOptions, TTSVoice } from '@renderer/types/tts'

import { BaseTTSProvider, TTSCheckResult } from './BaseTTSProvider'

export class SiliconFlowProvider extends BaseTTSProvider {

  async getVoices(): Promise<TTSVoice[]> {
    // 硅基流动的系统预置音色
    const systemVoices: TTSVoice[] = [
      // 男声音色
      { id: 'alex', name: '沉稳男声 (Alex)', lang: 'zh-CN', gender: 'male', default: true },
      { id: 'benjamin', name: '低沉男声 (Benjamin)', lang: 'zh-CN', gender: 'male', default: false },
      { id: 'charles', name: '磁性男声 (Charles)', lang: 'zh-CN', gender: 'male', default: false },
      { id: 'david', name: '欢快男声 (David)', lang: 'zh-CN', gender: 'male', default: false },
      // 女声音色
      { id: 'anna', name: '沉稳女声 (Anna)', lang: 'zh-CN', gender: 'female', default: false },
      { id: 'bella', name: '激情女声 (Bella)', lang: 'zh-CN', gender: 'female', default: false },
      { id: 'claire', name: '温柔女声 (Claire)', lang: 'zh-CN', gender: 'female', default: false },
      { id: 'diana', name: '欢快女声 (Diana)', lang: 'zh-CN', gender: 'female', default: false }
    ]

    return systemVoices
  }

  async speak(options: TTSSpeakOptions): Promise<void> {
    if (!this.validateApiKey()) {
      throw new Error('SiliconFlow API key is required')
    }

    // 停止当前播放
    this.stop()

    try {
      const audioBlob = await this.synthesizeSpeech(options)
      const volume = options.volume ?? this.provider.settings.volume ?? 1.0

      await this.audioPlayer.playBlob(audioBlob, volume)
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
          'Authorization': `Bearer ${this.provider.apiKey}`,
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

    console.log('[SiliconFlowProvider] Synthesizing speech:', {
      model,
      voice: requestBody.voice,
      textLength: options.text.length,
      speed: requestBody.speed,
      gain: requestBody.gain
    })

    const response = await fetch(`${this.getApiHost()}/audio/speech`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.provider.apiKey}`,
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
}
