import i18n from '@renderer/i18n'

import { TTSServiceInterface } from './TTSServiceInterface'

/**
 * 免费在线TTS服务实现类
 * 使用免费的在线TTS服务，不需要API密钥
 */
export class MsTTSService implements TTSServiceInterface {
  private voice: string
  private outputFormat: string

  /**
   * 构造函数
   * @param voice 语音
   * @param outputFormat 输出格式
   */
  constructor(voice: string, outputFormat: string) {
    this.voice = voice
    this.outputFormat = outputFormat
    console.log('初始化MsTTSService，语音:', voice, '输出格式:', outputFormat)
  }

  /**
   * 验证参数
   * @throws 如果参数无效，抛出错误
   */
  private validateParams(): void {
    if (!this.voice) {
      throw new Error(i18n.t('settings.tts.error.no_mstts_voice'))
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

    try {
      console.log('使用免费在线TTS生成语音，音色:', this.voice)

      // 通过IPC调用主进程的MsTTSService
      const outputPath = await window.api.msTTS.synthesize(text, this.voice, this.outputFormat)

      // 读取生成的音频文件
      const audioData = await window.api.fs.read(outputPath)

      // 将Buffer转换为Blob
      return new Blob([audioData], { type: 'audio/mp3' })
    } catch (error: any) {
      console.error('免费在线TTS语音合成失败:', error)
      throw new Error(`免费在线TTS语音合成失败: ${error?.message || '未知错误'}`)
    }
  }
}
