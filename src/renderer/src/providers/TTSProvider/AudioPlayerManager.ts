import Logger from '@renderer/config/logger'

/**
 * 音频播放状态枚举
 */
enum AudioPlayerState {
  IDLE = 'idle',
  LOADING = 'loading',
  PLAYING = 'playing',
  PAUSED = 'paused',
  STOPPED = 'stopped',
  ERROR = 'error'
}

/**
 * 通用音频播放管理器
 * 用于消除 TTS Provider 中的重复代码
 */
export class AudioPlayerManager {
  private audioElement: HTMLAudioElement | null = null
  private state: AudioPlayerState = AudioPlayerState.IDLE

  /**
   * 设置播放状态
   */
  private setState(newState: AudioPlayerState): void {
    Logger.debug(`[AudioPlayerManager] State change: ${this.state} -> ${newState}`)
    this.state = newState
  }

  /**
   * 播放音频 Blob
   */
  async playBlob(audioBlob: Blob, volume?: number): Promise<void> {
    const audioUrl = URL.createObjectURL(audioBlob)

    return new Promise((resolve, reject) => {
      this.audioElement = new Audio(audioUrl)

      // 设置音量
      if (volume !== undefined) {
        this.audioElement.volume = Math.max(0, Math.min(1, volume))
      }

      // 设置事件监听器
      this.audioElement.onloadstart = () => {
        this.setState(AudioPlayerState.LOADING)
      }

      this.audioElement.onended = () => {
        this.setState(AudioPlayerState.IDLE)
        URL.revokeObjectURL(audioUrl)
        this.audioElement = null
        resolve()
      }

      this.audioElement.onpause = () => {
        this.setState(AudioPlayerState.PAUSED)
      }

      this.audioElement.onplay = () => {
        this.setState(AudioPlayerState.PLAYING)
      }

      this.audioElement.oncanplay = () => {
        // 当音频可以播放时，如果之前是加载状态，更新为播放状态
        if (this.state === AudioPlayerState.LOADING) {
          this.setState(AudioPlayerState.PLAYING)
        }
      }

      this.audioElement.onerror = () => {
        this.setState(AudioPlayerState.ERROR)
        URL.revokeObjectURL(audioUrl)
        this.audioElement = null
        reject(new Error('Audio playback failed'))
      }

      this.audioElement.play().catch(reject)
    })
  }

  /**
   * 播放 Base64 音频数据
   */
  async playBase64(base64AudioData: string, mimeType: string = 'audio/mp3', volume?: number): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.audioElement = new Audio()

        // 设置音量
        if (volume !== undefined) {
          this.audioElement.volume = Math.max(0, Math.min(1, volume))
        }

        // 设置音频源（Base64 数据）
        this.audioElement.src = `data:${mimeType};base64,${base64AudioData}`

        // 设置事件监听器
        this.audioElement.onloadeddata = () => {
          this.setState(AudioPlayerState.LOADING)
        }

        this.audioElement.onended = () => {
          this.setState(AudioPlayerState.IDLE)
          this.audioElement = null
          resolve()
        }

        this.audioElement.onpause = () => {
          this.setState(AudioPlayerState.PAUSED)
        }

        this.audioElement.onplay = () => {
          this.setState(AudioPlayerState.PLAYING)
        }

        this.audioElement.oncanplay = () => {
          // 当音频可以播放时，如果之前是加载状态，更新为播放状态
          if (this.state === AudioPlayerState.LOADING) {
            this.setState(AudioPlayerState.PLAYING)
          }
        }

        this.audioElement.onerror = () => {
          this.setState(AudioPlayerState.ERROR)
          this.audioElement = null
          reject(new Error('Audio playback failed'))
        }

        // 开始播放
        this.audioElement.play().catch(reject)
      } catch (error) {
        reject(error)
      }
    })
  }

  /**
   * 暂停播放
   */
  pause(): void {
    if (this.audioElement) {
      // 支持在播放和加载状态下暂停
      if (this.state === AudioPlayerState.PLAYING || this.state === AudioPlayerState.LOADING) {
        this.audioElement.pause()
        this.setState(AudioPlayerState.PAUSED)
      }
    }
  }

  /**
   * 恢复播放
   */
  resume(): void {
    if (this.audioElement && this.state === AudioPlayerState.PAUSED) {
      this.audioElement
        .play()
        .then(() => {
          this.setState(AudioPlayerState.PLAYING)
        })
        .catch((error) => {
          Logger.error('[AudioPlayerManager] Failed to resume audio:', error)
          this.setState(AudioPlayerState.ERROR)
        })
    }
  }

  /**
   * 停止播放
   */
  stop(): void {
    if (this.audioElement) {
      try {
        // 移除所有事件监听器，防止回调触发
        this.audioElement.onended = null
        this.audioElement.onerror = null
        this.audioElement.onpause = null
        this.audioElement.onplay = null
        this.audioElement.onloadstart = null
        this.audioElement.onloadeddata = null
        this.audioElement.oncanplay = null

        // 停止播放
        this.audioElement.pause()
        this.audioElement.currentTime = 0

        // 清理音频源
        if (this.audioElement.src && this.audioElement.src.startsWith('blob:')) {
          URL.revokeObjectURL(this.audioElement.src)
        }

        this.audioElement = null
      } catch (error) {
        // 忽略停止过程中的错误，确保清理完成
        Logger.warn('[AudioPlayerManager] Error during stop:', error)
        this.audioElement = null
      }
    }
    this.setState(AudioPlayerState.STOPPED)
  }

  /**
   * 检查是否正在播放
   */
  isPlaying(): boolean {
    return this.state === AudioPlayerState.PLAYING
  }

  /**
   * 检查是否已暂停
   */
  isPaused(): boolean {
    return this.state === AudioPlayerState.PAUSED
  }

  /**
   * 设置音量
   */
  setVolume(volume: number): void {
    if (this.audioElement) {
      this.audioElement.volume = Math.max(0, Math.min(1, volume))
    }
  }

  /**
   * 获取当前播放时间
   */
  getCurrentTime(): number {
    return this.audioElement?.currentTime || 0
  }

  /**
   * 获取总时长
   */
  getDuration(): number {
    return this.audioElement?.duration || 0
  }

  /**
   * 设置播放位置
   */
  setCurrentTime(time: number): void {
    if (this.audioElement) {
      this.audioElement.currentTime = time
    }
  }

  /**
   * 流式播放音频（支持实时流式数据）
   */
  async playStream(
    audioStream: ReadableStream<Uint8Array>,
    mimeType: string = 'audio/mpeg',
    volume?: number,
    options: { enablePause?: boolean } = {}
  ): Promise<void> {
    // 如果启用暂停功能，强制使用缓存模式以支持完整的暂停/恢复功能
    if (options.enablePause) {
      return this.playStreamAsBlob(audioStream, mimeType, volume)
    }

    // 检查 MediaSource 是否支持该 MIME 类型
    if (!MediaSource.isTypeSupported(mimeType)) {
      Logger.warn(`[AudioPlayerManager] MediaSource does not support ${mimeType}, falling back to Blob playback`)
      return this.playStreamAsBlob(audioStream, mimeType, volume)
    }

    return this.playStreamWithMediaSource(audioStream, mimeType, volume)
  }

  /**
   * 使用 MediaSource 播放流式音频
   */
  private playStreamWithMediaSource(
    audioStream: ReadableStream<Uint8Array>,
    mimeType: string,
    volume?: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const mediaSource = new MediaSource()
        const audioUrl = URL.createObjectURL(mediaSource)

        this.audioElement = new Audio(audioUrl)
        this.setupAudioElement(audioUrl, volume, resolve, reject)
        this.setupMediaSourceEvents(mediaSource, audioStream, mimeType, reject)

        // 开始播放
        this.audioElement.play().catch(reject)
      } catch (error) {
        reject(error)
      }
    })
  }

  /**
   * 设置音频元素的事件监听器
   */
  private setupAudioElement(
    audioUrl: string,
    volume: number | undefined,
    resolve: () => void,
    reject: (error: Error) => void
  ): void {
    if (!this.audioElement) return

    // 设置音量
    if (volume !== undefined) {
      this.audioElement.volume = Math.max(0, Math.min(1, volume))
    }

    // 设置事件监听器
    this.audioElement.onloadstart = () => this.setState(AudioPlayerState.LOADING)
    this.audioElement.onpause = () => this.setState(AudioPlayerState.PAUSED)
    this.audioElement.onplay = () => this.setState(AudioPlayerState.PLAYING)
    this.audioElement.oncanplay = () => {
      // 当音频可以播放时，如果之前是加载状态，更新为播放状态
      if (this.state === AudioPlayerState.LOADING) {
        this.setState(AudioPlayerState.PLAYING)
      }
    }

    this.audioElement.onended = () => {
      this.setState(AudioPlayerState.IDLE)
      URL.revokeObjectURL(audioUrl)
      this.audioElement = null
      resolve()
    }

    this.audioElement.onerror = () => {
      this.setState(AudioPlayerState.ERROR)
      URL.revokeObjectURL(audioUrl)
      this.audioElement = null
      reject(new Error('Audio playback failed'))
    }
  }

  /**
   * 设置 MediaSource 事件监听器
   */
  private setupMediaSourceEvents(
    mediaSource: MediaSource,
    audioStream: ReadableStream<Uint8Array>,
    mimeType: string,
    reject: (error: Error) => void
  ): void {
    mediaSource.addEventListener('sourceopen', async () => {
      try {
        await this.handleMediaSourceOpen(mediaSource, audioStream, mimeType)
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  /**
   * 作为回退方案，将流转换为 Blob 后播放
   */
  private async playStreamAsBlob(
    audioStream: ReadableStream<Uint8Array>,
    mimeType: string,
    volume?: number
  ): Promise<void> {
    try {
      // 读取所有流数据
      const reader = audioStream.getReader()
      const chunks: Uint8Array[] = []

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
      }

      // 合并所有数据块
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
      const audioData = new Uint8Array(totalLength)
      let offset = 0
      for (const chunk of chunks) {
        audioData.set(chunk, offset)
        offset += chunk.length
      }

      // 创建 Blob 并播放
      const audioBlob = new Blob([audioData], { type: mimeType })
      return this.playBlob(audioBlob, volume)
    } catch (error) {
      throw new Error(`Failed to play stream as blob: ${error}`)
    }
  }

  /**
   * 处理 MediaSource 打开事件
   */
  private async handleMediaSourceOpen(
    mediaSource: MediaSource,
    audioStream: ReadableStream<Uint8Array>,
    mimeType: string
  ): Promise<void> {
    // 检查 MediaSource 是否支持该 MIME 类型
    if (!MediaSource.isTypeSupported(mimeType)) {
      throw new Error(`MediaSource does not support MIME type: ${mimeType}`)
    }

    const sourceBuffer = mediaSource.addSourceBuffer(mimeType)
    const reader = audioStream.getReader()

    await this.pumpAudioData(reader, sourceBuffer, mediaSource)
  }

  /**
   * 泵送音频数据到 SourceBuffer
   */
  private async pumpAudioData(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    sourceBuffer: SourceBuffer,
    mediaSource: MediaSource
  ): Promise<void> {
    try {
      const { done, value } = await reader.read()

      if (done) {
        await this.finalizeMediaSource(sourceBuffer, mediaSource)
        return
      }

      // 检查 MediaSource 和 SourceBuffer 状态
      if (mediaSource.readyState !== 'open') {
        Logger.warn('[AudioPlayerManager] MediaSource is not open, state:', mediaSource.readyState)
        return
      }

      await this.appendBufferToSourceBuffer(sourceBuffer, value)

      // 递归处理下一个数据块
      return this.pumpAudioData(reader, sourceBuffer, mediaSource)
    } catch (error) {
      Logger.error('[AudioPlayerManager] Error in pump function:', error)
      throw error
    }
  }

  /**
   * 完成 MediaSource 流
   */
  private async finalizeMediaSource(sourceBuffer: SourceBuffer, mediaSource: MediaSource): Promise<void> {
    // 确保 SourceBuffer 完成所有更新后再结束流
    if (sourceBuffer.updating) {
      await this.waitForSourceBufferUpdate(sourceBuffer)
    }

    if (mediaSource.readyState === 'open') {
      try {
        mediaSource.endOfStream()
      } catch (error) {
        Logger.warn('[AudioPlayerManager] Failed to end stream:', error)
        // 忽略 endOfStream 错误，因为音频已经播放成功
      }
    }
  }

  /**
   * 将数据添加到 SourceBuffer
   */
  private async appendBufferToSourceBuffer(sourceBuffer: SourceBuffer, value: Uint8Array): Promise<void> {
    // 等待 SourceBuffer 准备好
    if (sourceBuffer.updating) {
      await this.waitForSourceBufferUpdate(sourceBuffer)
    }

    // 再次检查状态
    if (sourceBuffer.updating) {
      Logger.error('[AudioPlayerManager] SourceBuffer still updating after wait')
      throw new Error('SourceBuffer is still updating')
    }

    // 添加数据到 SourceBuffer
    try {
      sourceBuffer.appendBuffer(value)
    } catch (error) {
      Logger.error('[AudioPlayerManager] Failed to append buffer:', error)
      throw error
    }

    // 等待 appendBuffer 操作完成
    await this.waitForSourceBufferUpdate(sourceBuffer)
  }

  /**
   * 等待 SourceBuffer 更新完成
   */
  private async waitForSourceBufferUpdate(sourceBuffer: SourceBuffer): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('SourceBuffer update timeout'))
      }, 5000) // 5秒超时

      sourceBuffer.addEventListener(
        'updateend',
        () => {
          clearTimeout(timeout)
          resolve(undefined)
        },
        { once: true }
      )

      sourceBuffer.addEventListener(
        'error',
        () => {
          clearTimeout(timeout)
          reject(new Error('SourceBuffer update error'))
        },
        { once: true }
      )
    })
  }
}
