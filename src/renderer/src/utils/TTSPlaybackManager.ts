/**
 * 简单的TTS播放状态管理器
 * 使用状态机模式管理全局播放状态
 */

type PlaybackState = 'idle' | 'playing' | 'paused'

interface PlaybackInfo {
  state: PlaybackState
  currentMessageId: string | null
}

class TTSPlaybackManager {
  private static instance: TTSPlaybackManager
  private playbackInfo: PlaybackInfo = {
    state: 'idle',
    currentMessageId: null
  }
  private listeners: Set<(info: PlaybackInfo) => void> = new Set()

  static getInstance(): TTSPlaybackManager {
    if (!TTSPlaybackManager.instance) {
      TTSPlaybackManager.instance = new TTSPlaybackManager()
    }
    return TTSPlaybackManager.instance
  }

  /**
   * 状态机：处理播放状态转移
   * 状态转移：idle → playing → paused → playing → idle
   */
  togglePlayback(messageId: string): { action: 'start' | 'stop' | 'pause' | 'resume'; newState: PlaybackState } {
    const currentState = this.playbackInfo.state
    const isCurrentMessage = this.playbackInfo.currentMessageId === messageId

    switch (currentState) {
      case 'idle':
        // 空闲 → 开始播放
        this.playbackInfo = {
          state: 'playing',
          currentMessageId: messageId
        }
        this.notifyListeners()
        return { action: 'start', newState: 'playing' }

      case 'playing':
        if (isCurrentMessage) {
          // 当前消息正在播放 → 直接停止
          this.playbackInfo = {
            state: 'idle',
            currentMessageId: null
          }
          this.notifyListeners()
          return { action: 'stop', newState: 'idle' }
        } else {
          // 其他消息正在播放 → 停止当前，开始新的
          this.playbackInfo = {
            state: 'playing',
            currentMessageId: messageId
          }
          this.notifyListeners()
          return { action: 'start', newState: 'playing' }
        }

      case 'paused':
        // 暂停状态也直接切换到新的播放或停止
        if (isCurrentMessage) {
          // 当前消息已暂停 → 停止
          this.playbackInfo = {
            state: 'idle',
            currentMessageId: null
          }
          this.notifyListeners()
          return { action: 'stop', newState: 'idle' }
        } else {
          // 其他消息暂停中 → 停止当前，开始新的
          this.playbackInfo = {
            state: 'playing',
            currentMessageId: messageId
          }
          this.notifyListeners()
          return { action: 'start', newState: 'playing' }
        }

      default:
        throw new Error(`Unknown playback state: ${currentState}`)
    }
  }

  /**
   * 暂停/恢复播放
   */
  togglePause(messageId: string): { action: 'pause' | 'resume'; newState: PlaybackState } {
    const isCurrentMessage = this.playbackInfo.currentMessageId === messageId

    if (!isCurrentMessage) {
      throw new Error('Cannot pause/resume a different message')
    }

    switch (this.playbackInfo.state) {
      case 'playing':
        // 播放中 → 暂停
        this.playbackInfo = {
          state: 'paused',
          currentMessageId: messageId
        }
        this.notifyListeners()
        return { action: 'pause', newState: 'paused' }

      case 'paused':
        // 暂停中 → 恢复播放
        this.playbackInfo = {
          state: 'playing',
          currentMessageId: messageId
        }
        this.notifyListeners()
        return { action: 'resume', newState: 'playing' }

      default:
        throw new Error(`Cannot pause/resume from state: ${this.playbackInfo.state}`)
    }
  }

  /**
   * 直接设置播放状态（用于播放完成等情况）
   */
  setPlaybackState(state: PlaybackState, messageId: string | null = null): void {
    this.playbackInfo = {
      state,
      currentMessageId: messageId
    }
    this.notifyListeners()
  }

  /**
   * 获取当前播放信息
   */
  getPlaybackInfo(): PlaybackInfo {
    return { ...this.playbackInfo }
  }

  /**
   * 检查指定消息是否正在播放
   */
  isMessagePlaying(messageId: string): boolean {
    return this.playbackInfo.state === 'playing' && this.playbackInfo.currentMessageId === messageId
  }

  /**
   * 检查指定消息是否已暂停1
   */
  isMessagePaused(messageId: string): boolean {
    return this.playbackInfo.state === 'paused' && this.playbackInfo.currentMessageId === messageId
  }

  /**
   * 添加状态监听器
   */
  addListener(listener: (info: PlaybackInfo) => void): void {
    this.listeners.add(listener)
  }

  /**
   * 移除状态监听器
   */
  removeListener(listener: (info: PlaybackInfo) => void): void {
    this.listeners.delete(listener)
  }

  /**
   * 通知所有监听器
   */
  private notifyListeners(): void {
    this.listeners.forEach((listener) => listener(this.playbackInfo))
  }
}

export default TTSPlaybackManager
