import fs from 'node:fs'
import path from 'node:path'

import { app } from 'electron'
import log from 'electron-log'
import { EdgeTTS } from 'node-edge-tts'

/**
 * Microsoft Edge TTS服务
 * 使用Microsoft Edge的在线TTS服务，不需要API密钥
 */
class MsEdgeTTSService {
  private static instance: MsEdgeTTSService
  private tempDir: string

  private constructor() {
    this.tempDir = path.join(app.getPath('temp'), 'cherry-tts')

    // 确保临时目录存在
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true })
    }
  }

  /**
   * 获取单例实例
   */
  public static getInstance(): MsEdgeTTSService {
    if (!MsEdgeTTSService.instance) {
      MsEdgeTTSService.instance = new MsEdgeTTSService()
    }
    return MsEdgeTTSService.instance
  }

  /**
   * 获取可用的语音列表
   * @returns 语音列表
   */
  public async getVoices(): Promise<any[]> {
    try {
      // 返回预定义的中文语音列表
      return [
        { name: 'zh-CN-XiaoxiaoNeural', locale: 'zh-CN', gender: 'Female' },
        { name: 'zh-CN-YunxiNeural', locale: 'zh-CN', gender: 'Male' },
        { name: 'zh-CN-YunyangNeural', locale: 'zh-CN', gender: 'Male' },
        { name: 'zh-CN-XiaohanNeural', locale: 'zh-CN', gender: 'Female' },
        { name: 'zh-CN-XiaomoNeural', locale: 'zh-CN', gender: 'Female' },
        { name: 'zh-CN-XiaoxuanNeural', locale: 'zh-CN', gender: 'Female' },
        { name: 'zh-CN-XiaoruiNeural', locale: 'zh-CN', gender: 'Female' },
        { name: 'zh-CN-YunfengNeural', locale: 'zh-CN', gender: 'Male' }
      ]
    } catch (error) {
      log.error('获取Microsoft Edge TTS语音列表失败:', error)
      throw error
    }
  }

  /**
   * 合成语音
   * @param text 要合成的文本
   * @param voice 语音
   * @param outputFormat 输出格式
   * @returns 音频文件路径
   */
  public async synthesize(text: string, voice: string, outputFormat: string): Promise<string> {
    try {
      log.info(`Microsoft Edge TTS合成语音: 文本="${text.substring(0, 30)}...", 语音=${voice}, 格式=${outputFormat}`)

      // 验证输入参数
      if (!text || text.trim() === '') {
        throw new Error('要合成的文本不能为空')
      }

      if (!voice || voice.trim() === '') {
        throw new Error('语音名称不能为空')
      }

      // 创建一个新的EdgeTTS实例，并设置参数
      const tts = new EdgeTTS({
        voice: voice,
        outputFormat: outputFormat,
        timeout: 30000, // 30秒超时
        rate: '+0%', // 正常语速
        pitch: '+0Hz', // 正常音调
        volume: '+0%' // 正常音量
      })

      // 生成临时文件路径
      const timestamp = Date.now()
      const fileExtension = outputFormat.includes('mp3') ? 'mp3' : outputFormat.split('-').pop() || 'audio'
      const outputPath = path.join(this.tempDir, `tts_${timestamp}.${fileExtension}`)

      log.info(`开始生成语音文件: ${outputPath}`)

      // 使用ttsPromise方法生成文件
      await tts.ttsPromise(text, outputPath)

      // 验证生成的文件是否存在且大小大于0
      if (!fs.existsSync(outputPath)) {
        throw new Error(`生成的语音文件不存在: ${outputPath}`)
      }

      const stats = fs.statSync(outputPath)
      if (stats.size === 0) {
        throw new Error(`生成的语音文件大小为0: ${outputPath}`)
      }

      log.info(`Microsoft Edge TTS合成成功: ${outputPath}, 文件大小: ${stats.size} 字节`)
      return outputPath
    } catch (error: any) {
      // 记录详细的错误信息
      log.error(`Microsoft Edge TTS语音合成失败 (语音=${voice}):`, error)

      // 尝试提供更有用的错误信息
      if (error.message && typeof error.message === 'string') {
        if (error.message.includes('Timed out')) {
          throw new Error(`语音合成超时，请检查网络连接或尝试其他语音`)
        } else if (error.message.includes('ENOTFOUND')) {
          throw new Error(`无法连接到Microsoft语音服务，请检查网络连接`)
        } else if (error.message.includes('ECONNREFUSED')) {
          throw new Error(`连接被拒绝，请检查网络设置或代理配置`)
        }
      }

      throw error
    }
  }
}

// 导出单例方法
export const getVoices = async () => {
  return await MsEdgeTTSService.getInstance().getVoices()
}

export const synthesize = async (text: string, voice: string, outputFormat: string) => {
  return await MsEdgeTTSService.getInstance().synthesize(text, voice, outputFormat)
}
