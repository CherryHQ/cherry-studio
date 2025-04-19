import i18n from '@renderer/i18n'

import { TTSServiceInterface } from './TTSServiceInterface'

/**
 * OpenAI TTS服务实现类
 */
export class OpenAITTSService implements TTSServiceInterface {
  private apiKey: string
  private apiUrl: string
  private voice: string
  private model: string

  /**
   * 构造函数
   * @param apiKey OpenAI API密钥
   * @param apiUrl OpenAI API地址
   * @param voice 语音
   * @param model 模型
   */
  constructor(apiKey: string, apiUrl: string, voice: string, model: string) {
    this.apiKey = apiKey
    this.apiUrl = apiUrl
    this.voice = voice
    this.model = model
  }

  /**
   * 验证参数
   * @throws 如果参数无效，抛出错误
   */
  private validateParams(): void {
    if (!this.apiKey) {
      throw new Error(i18n.t('settings.tts.error.no_api_key'))
    }

    if (!this.apiUrl) {
      throw new Error(i18n.t('settings.tts.error.no_api_url'))
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

    // 准备OpenAI TTS请求体
    const requestBody: any = {
      input: text
    }

    // 只有当模型和音色不为空时才添加到请求体中
    if (this.model) {
      requestBody.model = this.model
    }

    if (this.voice) {
      requestBody.voice = this.voice
    }

    // 调用OpenAI TTS API
    console.log('调用OpenAI TTS API，开始合成语音')
    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error?.message || 'OpenAI语音合成失败')
    }

    // 获取音频数据
    console.log('获取到OpenAI TTS响应，开始处理音频数据')
    return await response.blob()
  }
}
