import i18n from '@renderer/i18n'
import store from '@renderer/store'
import { setLastPlayedMessageId } from '@renderer/store/settings'
import { Message } from '@renderer/types'

import { TextSegmenter } from './TextSegmenter'
import { TTSServiceFactory } from './TTSServiceFactory'
import { TTSTextFilter } from './TTSTextFilter'

/**
 * TTS服务类
 * 用于处理文本到语音的转换
 */
// 音频段落接口
interface AudioSegment {
  text: string // 段落文本
  audioBlob?: Blob // 对应的音频Blob
  audioUrl?: string // 音频URL
  isLoaded: boolean // 是否已加载
  isLoading: boolean // 是否正在加载
}

export class TTSService {
  private static instance: TTSService
  private audioElement: HTMLAudioElement | null = null
  private isPlaying = false
  private playingServiceType: string | null = null
  private playingMessageId: string | null = null
  private progressUpdateInterval: NodeJS.Timeout | null = null

  // 分段播放相关属性
  private audioSegments: AudioSegment[] = []
  private currentSegmentIndex: number = 0
  private isSegmentedPlayback: boolean = false

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
      // 只有在非EdgeTTS服务时才直接更新状态
      if (this.playingServiceType !== 'edge') {
        this.updatePlayingState(false)
        console.log('TTS播放结束 (音频元素事件)')
      }
    })

    // 监听浏览器TTS直接播放结束的自定义事件
    document.addEventListener('edgeTTSComplete', () => {
      console.log('收到浏览器TTS直接播放结束事件')
      this.updatePlayingState(false)
    })

    // 监听全局的speechSynthesis状态
    if ('speechSynthesis' in window) {
      // 创建一个定时器，定期检查speechSynthesis的状态
      setInterval(() => {
        // 只有在使用EdgeTTS且标记为正在播放时才检查
        if (this.isPlaying && this.playingServiceType === 'edge') {
          // 检查是否还在播放
          const isSpeaking = window.speechSynthesis.speaking
          if (!isSpeaking) {
            console.log('检测到speechSynthesis不再播放，更新状态')
            this.updatePlayingState(false)
          }
        }
      }, 500) // 每500毫秒检查一次
    }
  }

  /**
   * 从消息中提取文本并播放
   * @param message 消息对象
   * @param segmented 是否使用分段播放
   * @returns 是否成功播放
   */
  public async speakFromMessage(message: Message, segmented: boolean = false): Promise<boolean> {
    // 获取最新的TTS过滤选项
    const settings = store.getState().settings
    const ttsFilterOptions = settings.ttsFilterOptions || {
      filterThinkingProcess: true,
      filterMarkdown: true,
      filterCodeBlocks: true,
      filterHtmlTags: true,
      filterEmojis: true,
      maxTextLength: 4000
    }

    // 更新最后播放的消息ID
    const dispatch = store.dispatch
    dispatch(setLastPlayedMessageId(message.id))
    console.log('更新最后播放的消息ID:', message.id)

    // 记录当前正在播放的消息ID
    this.playingMessageId = message.id

    // 应用过滤
    const filteredText = TTSTextFilter.filterText(message.content, ttsFilterOptions)
    console.log('TTS过滤前文本长度:', message.content.length, '过滤后:', filteredText.length)

    // 播放过滤后的文本
    return this.speak(filteredText, segmented)
  }

  /**
   * 更新播放状态并触发事件
   * @param isPlaying 是否正在播放
   */
  private updatePlayingState(isPlaying: boolean): void {
    // 只有状态变化时才更新和触发事件
    if (this.isPlaying !== isPlaying) {
      this.isPlaying = isPlaying
      console.log(`TTS播放状态更新: ${isPlaying ? '开始播放' : '停止播放'}`)

      // 触发自定义事件，通知其他组件TTS状态变化
      const event = new CustomEvent('tts-state-change', { detail: { isPlaying } })
      window.dispatchEvent(event)

      // 如果开始播放，启动进度更新定时器
      if (isPlaying && this.audioElement) {
        this.startProgressUpdates()
      }

      // 如果停止播放，清除服务类型和定时器
      if (!isPlaying) {
        this.playingServiceType = null
        this.stopProgressUpdates()

        // 确保Web Speech API也停止
        if ('speechSynthesis' in window) {
          window.speechSynthesis.cancel()
        }
      }
    }
  }

  /**
   * 播放文本
   * @param text 要播放的文本
   * @param segmented 是否使用分段播放
   * @returns 是否成功播放
   */
  public async speak(text: string, segmented: boolean = false): Promise<boolean> {
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
        // 添加短暂延迟，确保上一个播放完全停止
        await new Promise((resolve) => setTimeout(resolve, 100))
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
      // 记录当前使用的服务类型
      this.playingServiceType = serviceType

      // 设置分段播放模式
      this.isSegmentedPlayback = segmented

      if (segmented) {
        // 分段播放模式
        return await this.speakSegmented(text, serviceType, latestSettings)
      }

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

            // 更新播放状态
            this.updatePlayingState(true)
            console.log('开始播放TTS音频')

            // 释放URL对象
            this.audioElement.onended = () => {
              URL.revokeObjectURL(audioUrl)

              // 检查是否是浏览器TTS直接播放的情况
              const isEdgeTTS = serviceType === 'edge'
              const isSmallBlob = audioBlob.size < 100

              // 对于非EdgeTTS服务，直接更新状态
              // EdgeTTS服务的状态更新由定时器和edgeTTSComplete事件处理
              if (!(isEdgeTTS && isSmallBlob)) {
                this.updatePlayingState(false)
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
      console.log('强制停止TTS播放')
    }

    // 如果是EdgeTTS，确保Web Speech API也停止
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel()
      console.log('停止Web Speech API播放')
    }

    // 停止进度更新
    this.stopProgressUpdates()

    // 更新状态并触发事件
    this.updatePlayingState(false)

    // 清除正在播放的消息ID
    this.playingMessageId = null

    // 发送一个最终的进度更新事件，确保进度条消失
    this.emitProgressUpdateEvent(0, 0, 0)

    // 如果是分段播放模式，不清理资源，以便用户可以从其他段落继续播放
  }

  /**
   * 检查是否正在播放
   * @returns 是否正在播放
   */
  public isCurrentlyPlaying(): boolean {
    return this.isPlaying
  }

  /**
   * 跳转到指定时间点
   * @param time 时间（秒）
   * @returns 是否成功跳转
   */
  public seek(time: number): boolean {
    if (!this.audioElement || !this.isPlaying) {
      console.log('无法跳转，音频元素不存在或未在播放中')
      return false
    }

    try {
      // 确保时间在有效范围内
      const duration = this.audioElement.duration || 0
      const validTime = Math.max(0, Math.min(time, duration))

      console.log(`跳转到时间点: ${validTime.toFixed(2)}秒 / ${duration.toFixed(2)}秒`)
      this.audioElement.currentTime = validTime
      return true
    } catch (error) {
      console.error('跳转失败:', error)
      return false
    }
  }

  /**
   * 从指定段落开始播放
   * @param index 段落索引
   * @returns 是否成功开始播放
   */
  public playFromSegment(index: number): boolean {
    console.log(`请求从段落 ${index} 开始播放`)

    // 如果当前不是分段播放模式，则先将当前消息切换为分段播放模式
    if (!this.isSegmentedPlayback) {
      console.log('当前不是分段播放模式，无法从指定段落开始播放')
      return false
    }

    if (index < 0 || index >= this.audioSegments.length) {
      console.log(`段落索引超出范围: ${index}, 总段落数: ${this.audioSegments.length}`)
      return false
    }

    // 如果正在播放，先停止
    if (this.isPlaying) {
      console.log('停止当前播放')
      this.stop()
    }

    console.log(`开始播放段落 ${index}: ${this.audioSegments[index].text.substring(0, 20)}...`)

    // 开始播放指定段落
    return this.playSegment(index)
  }

  /**
   * 分段播放模式
   * @param text 要播放的文本
   * @param serviceType TTS服务类型
   * @param settings 设置
   * @returns 是否成功播放
   */
  private async speakSegmented(text: string, serviceType: string, settings: any): Promise<boolean> {
    try {
      console.log('开始分段播放模式')

      // 分割文本为句子
      const sentences = TextSegmenter.splitIntoSentences(text)
      console.log(`文本分割为 ${sentences.length} 个段落`)

      if (sentences.length === 0) {
        console.log('没有有效段落，取消播放')
        return false
      }

      // 创建音频段落数组
      this.audioSegments = sentences.map((sentence) => ({
        text: sentence,
        isLoaded: false,
        isLoading: false
      }))

      // 设置分段播放模式
      this.isSegmentedPlayback = true

      // 重置当前段落索引
      this.currentSegmentIndex = 0

      // 触发分段播放事件
      this.emitSegmentedPlaybackEvent()

      // 预加载所有段落，确保完整播放
      for (let i = 0; i < sentences.length; i++) {
        // 使用setTimeout错开加载时间，避免同时发起过多请求
        setTimeout(() => {
          if (this.isSegmentedPlayback) {
            // 确保仍然在分段播放模式
            this.loadSegmentAudio(i, serviceType, settings)
          }
        }, i * 100) // 每100毫秒加载一个段落
      }

      // 不自动开始播放，等待用户点击
      console.log('分段播放模式已准备就绪，等待用户点击')
      return true
    } catch (error: any) {
      console.error('TTS分段播放失败:', error)
      this.showErrorMessage(error?.message || i18n.t('settings.tts.error.synthesis_failed'))
      return false
    }
  }

  /**
   * 加载段落音频
   * @param index 段落索引
   * @param serviceType TTS服务类型
   * @param settings 设置
   */
  private async loadSegmentAudio(index: number, serviceType: string, settings: any): Promise<void> {
    if (index < 0 || index >= this.audioSegments.length) {
      return
    }

    const segment = this.audioSegments[index]

    // 如果已加载或正在加载，则跳过
    if (segment.isLoaded || segment.isLoading) {
      return
    }

    // 标记为正在加载
    segment.isLoading = true
    this.emitSegmentedPlaybackEvent()

    try {
      // 创建TTS服务
      const ttsService = TTSServiceFactory.createService(serviceType, settings)

      // 合成音频
      const audioBlob = await ttsService.synthesize(segment.text)

      // 创建音频URL
      const audioUrl = URL.createObjectURL(audioBlob)

      // 更新段落信息
      segment.audioBlob = audioBlob
      segment.audioUrl = audioUrl
      segment.isLoaded = true
      segment.isLoading = false

      // 触发事件
      this.emitSegmentedPlaybackEvent()

      // 如果是当前播放的段落，且尚未开始播放，则开始播放
      if (index === this.currentSegmentIndex && this.isSegmentedPlayback && !this.isPlaying) {
        this.playSegment(index)
      }
    } catch (error) {
      console.error(`加载段落音频失败 (索引: ${index}):`, error)
      segment.isLoading = false
      this.emitSegmentedPlaybackEvent()
    }
  }

  /**
   * 播放指定段落
   * @param index 段落索引
   * @returns 是否成功开始播放
   */
  private playSegment(index: number): boolean {
    if (index < 0 || index >= this.audioSegments.length) {
      return false
    }

    const segment = this.audioSegments[index]

    // 如果段落尚未加载完成，则等待加载
    if (!segment.isLoaded) {
      // 如果尚未开始加载，则开始加载
      if (!segment.isLoading) {
        const settings = store.getState().settings
        const serviceType = settings.ttsServiceType || 'openai'
        this.loadSegmentAudio(index, serviceType, settings)
      }
      return true // 返回true表示已开始处理，但尚未实际播放
    }

    // 更新当前段落索引
    this.currentSegmentIndex = index

    // 触发事件
    this.emitSegmentedPlaybackEvent()

    // 播放音频
    if (this.audioElement && segment.audioUrl) {
      this.audioElement.src = segment.audioUrl
      this.audioElement.play().catch((error) => {
        console.error('播放段落音频失败:', error)
      })

      // 更新播放状态
      this.updatePlayingState(true)

      // 设置音频结束事件
      this.audioElement.onended = () => {
        // 播放下一个段落
        if (index < this.audioSegments.length - 1) {
          this.playSegment(index + 1)
        } else {
          // 所有段落播放完毕
          this.updatePlayingState(false)

          // 清理资源
          this.cleanupSegmentedPlayback()
        }
      }

      return true
    }

    return false
  }

  /**
   * 清理分段播放资源
   */
  private cleanupSegmentedPlayback(): void {
    // 释放所有音频URL
    for (const segment of this.audioSegments) {
      if (segment.audioUrl) {
        URL.revokeObjectURL(segment.audioUrl)
      }
    }

    // 重置状态
    this.audioSegments = []
    this.currentSegmentIndex = 0
    this.isSegmentedPlayback = false

    // 触发事件
    this.emitSegmentedPlaybackEvent()

    console.log('分段播放已完成，资源已清理')
  }

  /**
   * 启动进度更新定时器
   */
  private startProgressUpdates(): void {
    // 先停止现有的定时器
    this.stopProgressUpdates()

    // 确保音频元素存在
    if (!this.audioElement) return

    // 创建新的定时器，每100毫秒更新一次进度
    this.progressUpdateInterval = setInterval(() => {
      if (this.audioElement && this.isPlaying) {
        const currentTime = this.audioElement.currentTime
        const duration = this.audioElement.duration || 0

        // 计算进度百分比
        const progress = duration > 0 ? (currentTime / duration) * 100 : 0

        // 触发进度更新事件
        this.emitProgressUpdateEvent(currentTime, duration, progress)
      }
    }, 250) // 将更新频率从100ms降低到250ms，减少日志输出
  }

  /**
   * 停止进度更新定时器
   */
  private stopProgressUpdates(): void {
    if (this.progressUpdateInterval) {
      clearInterval(this.progressUpdateInterval)
      this.progressUpdateInterval = null
    }
  }

  /**
   * 触发进度更新事件
   * @param currentTime 当前播放时间（秒）
   * @param duration 总时长（秒）
   * @param progress 进度百分比（0-100）
   */
  // 记录上次输出日志的进度百分比 - 已禁用日志输出
  // private lastLoggedProgress: number = -1;
  // 记录上次日志输出时间，用于节流 - 已禁用日志输出
  // private lastLogTime: number = 0;

  private emitProgressUpdateEvent(currentTime: number, duration: number, progress: number): void {
    // 创建事件数据
    const eventData = {
      messageId: this.playingMessageId,
      isPlaying: this.isPlaying,
      currentTime,
      duration,
      progress
    }

    // 完全关闭进度更新日志输出
    // const now = Date.now();
    // const currentProgressTens = Math.floor(progress / 10);
    // if ((now - this.lastLogTime >= 500) && // 时间节流
    //     (currentProgressTens !== Math.floor(this.lastLoggedProgress / 10) ||
    //     progress === 0 || progress >= 100)) {
    //   console.log('发送TTS进度更新事件:', {
    //     messageId: this.playingMessageId ? this.playingMessageId.substring(0, 8) : null,
    //     progress: Math.round(progress),
    //     currentTime: Math.round(currentTime),
    //     duration: Math.round(duration)
    //   });
    //   this.lastLoggedProgress = progress;
    //   this.lastLogTime = now;
    // }

    // 触发事件
    window.dispatchEvent(new CustomEvent('tts-progress-update', { detail: eventData }))
  }

  /**
   * 触发分段播放事件
   */
  private emitSegmentedPlaybackEvent(): void {
    // 创建事件数据
    const eventData = {
      isSegmentedPlayback: this.isSegmentedPlayback,
      segments: this.audioSegments.map((segment) => ({
        text: segment.text,
        isLoaded: segment.isLoaded,
        isLoading: segment.isLoading
      })),
      currentSegmentIndex: this.currentSegmentIndex,
      isPlaying: this.isPlaying
    }

    // 触发事件
    window.dispatchEvent(new CustomEvent('tts-segmented-playback-update', { detail: eventData }))
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
