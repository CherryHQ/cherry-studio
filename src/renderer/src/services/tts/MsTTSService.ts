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
      // 如果没有设置音色，使用默认的小晓音色
      console.warn('未设置免费在线TTS音色，使用默认音色 zh-CN-XiaoxiaoNeural')
      this.voice = 'zh-CN-XiaoxiaoNeural'
    }

    if (!this.outputFormat) {
      // 如果没有设置输出格式，使用默认格式
      console.warn('未设置免费在线TTS输出格式，使用默认格式 audio-24khz-48kbitrate-mono-mp3')
      this.outputFormat = 'audio-24khz-48kbitrate-mono-mp3'
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
