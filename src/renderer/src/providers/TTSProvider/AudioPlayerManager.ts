/**
 * 通用音频播放管理器
 * 用于消除 TTS Provider 中的重复代码
 */
export class AudioPlayerManager {
  private audioElement: HTMLAudioElement | null = null
  private _isPlaying = false
  private _isPaused = false

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
        this._isPlaying = true
        this._isPaused = false
      }

      this.audioElement.onended = () => {
        this._isPlaying = false
        this._isPaused = false
        URL.revokeObjectURL(audioUrl)
        this.audioElement = null
        resolve()
      }

      this.audioElement.onpause = () => {
        this._isPaused = true
      }

      this.audioElement.onplay = () => {
        this._isPaused = false
      }

      this.audioElement.onerror = () => {
        this._isPlaying = false
        this._isPaused = false
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
          this._isPlaying = true
          this._isPaused = false
        }

        this.audioElement.onended = () => {
          this._isPlaying = false
          this._isPaused = false
          this.audioElement = null
          resolve()
        }

        this.audioElement.onpause = () => {
          this._isPaused = true
        }

        this.audioElement.onplay = () => {
          this._isPaused = false
        }

        this.audioElement.onerror = () => {
          this._isPlaying = false
          this._isPaused = false
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
    if (this.audioElement && this._isPlaying && !this._isPaused) {
      this.audioElement.pause()
      this._isPaused = true
      this._isPlaying = false
    }
  }

  /**
   * 恢复播放
   */
  resume(): void {
    if (this.audioElement && this._isPaused) {
      this.audioElement.play()
      this._isPaused = false
      this._isPlaying = true
    }
  }

  /**
   * 停止播放
   */
  stop(): void {
    if (this.audioElement) {
      this.audioElement.pause()
      this.audioElement.currentTime = 0
      this.audioElement = null
    }
    this._isPlaying = false
    this._isPaused = false
  }

  /**
   * 检查是否正在播放
   */
  isPlaying(): boolean {
    return this._isPlaying
  }

  /**
   * 检查是否已暂停
   */
  isPaused(): boolean {
    return this._isPaused
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
  async playStream(audioStream: ReadableStream<Uint8Array>, mimeType: string = 'audio/mp3', volume?: number): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // 创建 MediaSource 对象
        const mediaSource = new MediaSource()
        const audioUrl = URL.createObjectURL(mediaSource)

        this.audioElement = new Audio(audioUrl)

        // 设置音量
        if (volume !== undefined) {
          this.audioElement.volume = Math.max(0, Math.min(1, volume))
        }

        // 设置事件监听器
        this.audioElement.onloadstart = () => {
          this._isPlaying = true
          this._isPaused = false
        }

        this.audioElement.onended = () => {
          this._isPlaying = false
          this._isPaused = false
          URL.revokeObjectURL(audioUrl)
          this.audioElement = null
          resolve()
        }

        this.audioElement.onpause = () => {
          this._isPaused = true
        }

        this.audioElement.onplay = () => {
          this._isPaused = false
        }

        this.audioElement.onerror = () => {
          this._isPlaying = false
          this._isPaused = false
          URL.revokeObjectURL(audioUrl)
          this.audioElement = null
          reject(new Error('Audio playback failed'))
        }

        // MediaSource 事件处理
        mediaSource.addEventListener('sourceopen', async () => {
          try {
            const sourceBuffer = mediaSource.addSourceBuffer(mimeType)
            const reader = audioStream.getReader()

            // 读取流数据
            const pump = async (): Promise<void> => {
              const { done, value } = await reader.read()

              if (done) {
                if (mediaSource.readyState === 'open') {
                  mediaSource.endOfStream()
                }
                return
              }

              // 等待 SourceBuffer 准备好
              if (sourceBuffer.updating) {
                await new Promise(resolve => {
                  sourceBuffer.addEventListener('updateend', resolve, { once: true })
                })
              }

              sourceBuffer.appendBuffer(value)
              return pump()
            }

            await pump()
          } catch (error) {
            reject(error)
          }
        })

        // 开始播放
        this.audioElement.play().catch(reject)
      } catch (error) {
        reject(error)
      }
    })
  }
}
