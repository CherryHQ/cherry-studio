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
   * @param segmented 是否使用分段播放
   */
  speak = async (text: string, segmented: boolean = false): Promise<void> => {
    await this.service.speak(text, segmented)
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
   * @param segmented 是否使用分段播放
   */
  speakFromMessage = async (message: Message, segmented: boolean = false): Promise<void> => {
    await this.service.speakFromMessage(message, segmented)
  }

  /**
   * 检查是否正在播放
   */
  isCurrentlyPlaying = (): boolean => {
    return this.service.isCurrentlyPlaying()
  }

  /**
   * 从指定段落开始播放
   * @param segmentIndex 段落索引
   */
  playFromSegment = (segmentIndex: number): void => {
    this.service.playFromSegment(segmentIndex)
  }

  /**
   * 跳转到指定时间点
   * @param time 时间（秒）
   */
  seek = (time: number): void => {
    this.service.seek(time)
  }
}

// 导出单例
export default new TTSService()
