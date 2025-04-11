import i18n from '@renderer/i18n'

import { TTSServiceInterface } from './TTSServiceInterface'

/**
 * 硅基流动TTS服务实现类
 */
export class SiliconflowTTSService implements TTSServiceInterface {
  private apiKey: string
  private apiUrl: string
  private voice: string
  private model: string
  private responseFormat: string
  private speed: number

  /**
   * 构造函数
   * @param apiKey 硅基流动API密钥
   * @param apiUrl 硅基流动API地址
   * @param voice 语音
   * @param model 模型
   * @param responseFormat 响应格式
   * @param speed 语速
   */
  constructor(
    apiKey: string,
    apiUrl: string,
    voice: string,
    model: string,
    responseFormat: string = 'mp3',
    speed: number = 1.0
  ) {
    this.apiKey = apiKey
    this.apiUrl = apiUrl || 'https://api.siliconflow.cn/v1/audio/speech'
    this.voice = voice
    this.model = model
    this.responseFormat = responseFormat
    this.speed = speed
  }

  /**
   * 验证参数
   * @throws 如果参数无效，抛出错误
   */
  private validateParams(): void {
    if (!this.apiKey) {
      throw new Error(i18n.t('settings.tts.error.no_api_key'))
    }

    if (!this.voice) {
      throw new Error(i18n.t('settings.tts.error.no_voice'))
    }

    if (!this.model) {
      throw new Error(i18n.t('settings.tts.error.no_model'))
    }
  }

  /**
   * 合成语音
   * @param text 要合成的文本
   * @returns 返回音频Blob对象的Promise
   */
  async synthesize(text: string): Promise<Blob> {
    // 验证参数
    this.validateParams()

    // 准备硅基流动TTS请求体
    const requestBody: any = {
      model: this.model,
      input: text,
      voice: this.voice,
      // 使用配置的响应格式，默认为mp3
      response_format: this.responseFormat,
      stream: false,
      speed: this.speed
    }

    console.log('硅基流动TTS请求参数:', {
      model: this.model,
      voice: this.voice,
      response_format: 'mp3',
      speed: this.speed
    })

    // 调用硅基流动TTS API
    console.log('调用硅基流动TTS API，开始合成语音')
    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
      let errorMessage = '硅基流动语音合成失败'
      try {
        const errorData = await response.json()
        errorMessage = errorData.error?.message || errorMessage
      } catch (e) {
        // 如果无法解析JSON，使用默认错误消息
      }
      throw new Error(errorMessage)
    }

    // 获取音频数据
    console.log('获取到硅基流动TTS响应，开始处理音频数据')

    // 获取原始Blob
    const originalBlob = await response.blob()

    // 创建一个新的Blob，并指定正确的MIME类型
    return new Blob([originalBlob], { type: 'audio/mpeg' })
  }
}
