/**
 * 已弃用，请使用 src/renderer/src/services/tts/TTSService.ts
 * 这个文件仅作兼容性保留，将在后续版本中移除
 */

import { Message } from '@renderer/types'

import { TTSService as NewTTSService } from './tts/index'

/**
 * TTS服务，用于将文本转换为语音
 * @deprecated 请使用 src/renderer/src/services/tts/TTSService.ts
 */
class TTSService {
  private service = NewTTSService.getInstance()

  /**
   * 将文本转换为语音并播放
   * @param text 要转换的文本
   */
  speak = async (text: string): Promise<void> => {
    await this.service.speak(text)
  }

  /**
   * 停止播放
   */
  stop = (): void => {
    this.service.stop()
  }

  /**
   * 从消息中提取文本并转换为语音
   * @param message 消息对象
   */
  speakFromMessage = async (message: Message): Promise<void> => {
    await this.service.speakFromMessage(message)
  }

  /**
   * 检查是否正在播放
   */
  isCurrentlyPlaying = (): boolean => {
    return this.service.isCurrentlyPlaying()
  }
}

// 导出单例
export default new TTSService()
