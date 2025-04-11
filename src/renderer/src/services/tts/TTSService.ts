import i18n from '@renderer/i18n'
import store from '@renderer/store'
import { setLastPlayedMessageId } from '@renderer/store/settings'
import { Message } from '@renderer/types'

import { TTSServiceFactory } from './TTSServiceFactory'
import { TTSTextFilter } from './TTSTextFilter'

/**
 * TTS服务类
 * 用于处理文本到语音的转换
 */
export class TTSService {
  private static instance: TTSService
  private audioElement: HTMLAudioElement | null = null
  private isPlaying = false

  // 错误消息节流控制
  private lastErrorTime = 0
  private errorThrottleTime = 2000 // 2秒内不重复显示相同错误

  /**
   * 获取单例实例
   * @returns TTSService实例
   */
  public static getInstance(): TTSService {
    // 每次调用时强制重新创建实例，确保使用最新的设置
    // 注意：这会导致每次调用时都创建新的音频元素，可能会有内存泄漏风险
    // 但在当前情况下，这是解决TTS服务类型切换问题的最简单方法
    TTSService.instance = new TTSService()
    return TTSService.instance
  }

  /**
   * 私有构造函数，防止外部实例化
   */
  private constructor() {
    // 创建音频元素
    this.audioElement = document.createElement('audio')
    this.audioElement.style.display = 'none'
    document.body.appendChild(this.audioElement)

    // 监听音频播放结束事件
    this.audioElement.addEventListener('ended', () => {
      this.isPlaying = false
      console.log('TTS播放结束')
    })

    // 监听浏览器TTS直接播放结束的自定义事件
    document.addEventListener('edgeTTSComplete', () => {
      console.log('收到浏览器TTS直接播放结束事件')
      this.isPlaying = false
    })
  }

  /**
   * 从消息中提取文本并播放
   * @param message 消息对象
   * @returns 是否成功播放
   */
  public async speakFromMessage(message: Message): Promise<boolean> {
    // 获取最新的TTS过滤选项
    const settings = store.getState().settings
    const ttsFilterOptions = settings.ttsFilterOptions || {
      filterThinkingProcess: true,
      filterMarkdown: true,
      filterCodeBlocks: true,
      filterHtmlTags: true,
      maxTextLength: 4000
    }

    // 更新最后播放的消息ID
    const dispatch = store.dispatch
    dispatch(setLastPlayedMessageId(message.id))
    console.log('更新最后播放的消息ID:', message.id)

    // 应用过滤
    const filteredText = TTSTextFilter.filterText(message.content, ttsFilterOptions)
    console.log('TTS过滤前文本长度:', message.content.length, '过滤后:', filteredText.length)

    // 播放过滤后的文本
    return this.speak(filteredText)
  }

  /**
   * 播放文本
   * @param text 要播放的文本
   * @returns 是否成功播放
   */
  public async speak(text: string): Promise<boolean> {
    try {
      // 检查TTS是否启用
      const settings = store.getState().settings
      const ttsEnabled = settings.ttsEnabled

      if (!ttsEnabled) {
        this.showErrorMessage(i18n.t('settings.tts.error.not_enabled'))
        return false
      }

      // 如果正在播放，先停止
      if (this.isPlaying) {
        this.stop()
      }

      // 确保文本不为空
      if (!text || text.trim() === '') {
        this.showErrorMessage(i18n.t('settings.tts.error.empty_text'))
        return false
      }

      // 获取最新的设置
      // 强制刷新状态对象，确保获取最新的设置
      const latestSettings = store.getState().settings
      const serviceType = latestSettings.ttsServiceType || 'openai'
      console.log('使用的TTS服务类型:', serviceType)
      console.log('当前TTS设置详情:', {
        ttsServiceType: serviceType,
        ttsEdgeVoice: latestSettings.ttsEdgeVoice,
        ttsSiliconflowApiKey: latestSettings.ttsSiliconflowApiKey ? '已设置' : '未设置',
        ttsSiliconflowVoice: latestSettings.ttsSiliconflowVoice,
        ttsSiliconflowModel: latestSettings.ttsSiliconflowModel,
        ttsSiliconflowResponseFormat: latestSettings.ttsSiliconflowResponseFormat,
        ttsSiliconflowSpeed: latestSettings.ttsSiliconflowSpeed
      })

      try {
        // 使用工厂创建TTS服务
        const ttsService = TTSServiceFactory.createService(serviceType, latestSettings)

        // 合成语音
        const audioBlob = await ttsService.synthesize(text)

        // 播放音频
        if (audioBlob) {
          const audioUrl = URL.createObjectURL(audioBlob)

          if (this.audioElement) {
            // 打印音频Blob信息，帮助调试
            console.log('音频Blob信息:', {
              size: audioBlob.size,
              type: audioBlob.type,
              serviceType: serviceType
            })

            this.audioElement.src = audioUrl
            this.audioElement.play().catch((error) => {
              // 检查是否是浏览器TTS直接播放的情况
              // 如果是浏览器TTS且音频大小很小，则不显示错误消息
              const isEdgeTTS = serviceType === 'edge'
              const isSmallBlob = audioBlob.size < 100 // 小于100字节的音频文件可能是我们的静音文件

              if (isEdgeTTS && isSmallBlob) {
                console.log('浏览器TTS直接播放中，忽略音频元素错误')
              } else {
                console.error('播放TTS音频失败:', error)
                console.error('音频URL:', audioUrl)
                console.error('音频Blob类型:', audioBlob.type)
                console.error('音频Blob大小:', audioBlob.size)
                this.showErrorMessage(i18n.t('settings.tts.error.play_failed'))
              }
            })

            this.isPlaying = true
            console.log('开始播放TTS音频')

            // 释放URL对象
            this.audioElement.onended = () => {
              URL.revokeObjectURL(audioUrl)

              // 检查是否是浏览器TTS直接播放的情况
              const isEdgeTTS = serviceType === 'edge'
              const isSmallBlob = audioBlob.size < 100

              // 如果是浏览器TTS直接播放，则等待当前语音合成结束
              if (isEdgeTTS && isSmallBlob) {
                // 检查全局变量中的当前语音合成状态
                // 如果还在播放，则不重置播放状态
                // 注意：这里我们无法直接访问 EdgeTTSService 中的 currentUtterance
                // 所以我们使用定时器来检查语音合成是否完成
                console.log('浏览器TTS直接播放中，等待语音合成结束')
                // 保持播放状态，直到语音合成结束
                // 使用定时器来检查语音合成是否完成
                // 大多数语音合成应该在几秒内完成
                setTimeout(() => {
                  this.isPlaying = false
                  console.log('浏览器TTS直接播放完成')
                }, 10000) // 10秒后自动重置状态
              } else {
                this.isPlaying = false
              }
            }

            return true
          }
        }

        return false
      } catch (error: any) {
        console.error('TTS合成失败:', error)
        this.showErrorMessage(error?.message || i18n.t('settings.tts.error.synthesis_failed'))
        return false
      }
    } catch (error) {
      console.error('TTS播放失败:', error)
      this.showErrorMessage(i18n.t('settings.tts.error.general'))
      return false
    }
  }

  /**
   * 停止播放
   */
  public stop(): void {
    // 无论是否正在播放，都强制停止
    if (this.audioElement) {
      this.audioElement.pause()
      this.audioElement.currentTime = 0
      this.isPlaying = false
      console.log('强制停止TTS播放')

      // 触发自定义事件，通知其他组件TTS已停止
      const event = new CustomEvent('tts-state-change', { detail: { isPlaying: false } })
      window.dispatchEvent(event)
    }
  }

  /**
   * 检查是否正在播放
   * @returns 是否正在播放
   */
  public isCurrentlyPlaying(): boolean {
    return this.isPlaying
  }

  /**
   * 显示错误消息，并进行节流控制
   * @param message 错误消息
   */
  private showErrorMessage(message: string): void {
    const now = Date.now()
    // 如果距离上次错误消息的时间小于节流时间，则不显示
    if (now - this.lastErrorTime < this.errorThrottleTime) {
      console.log('错误消息被节流：', message)
      return
    }

    // 更新上次错误消息时间
    this.lastErrorTime = now
    window.message.error({ content: message, key: 'tts-error' })
  }
}
