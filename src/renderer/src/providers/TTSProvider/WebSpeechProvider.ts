import { TTSSpeakOptions, TTSVoice } from '@renderer/types/tts'

import { BaseTTSProvider, TTSCheckResult } from './BaseTTSProvider'

export class WebSpeechProvider extends BaseTTSProvider {
  private _isStopping = false // 添加停止标志
  private _webSpeechIsPlaying = false
  private _webSpeechIsPaused = false

  async getVoices(): Promise<TTSVoice[]> {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) {
        resolve([])
        return
      }

      const loadVoices = () => {
        const voices = speechSynthesis.getVoices()
        const voiceList: TTSVoice[] = voices.map((voice) => ({
          id: voice.name,
          name: voice.name,
          lang: voice.lang,
          gender: this.detectGender(voice.name),
          default: voice.default
        }))
        resolve(voiceList)
      }

      // 如果语音已经加载，直接返回
      const voices = speechSynthesis.getVoices()
      if (voices.length > 0) {
        loadVoices()
      } else {
        // 等待语音加载完成
        speechSynthesis.addEventListener('voiceschanged', loadVoices, { once: true })
        // 设置超时，防止无限等待
        setTimeout(() => {
          speechSynthesis.removeEventListener('voiceschanged', loadVoices)
          loadVoices()
        }, 1000)
      }
    })
  }

  async speak(options: TTSSpeakOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!('speechSynthesis' in window)) {
        reject(new Error('Speech synthesis not supported'))
        return
      }

      // 停止当前播放
      this.stop()

      // 重置停止标志
      this._isStopping = false

      const utterance = new SpeechSynthesisUtterance(options.text)

      // 设置语音参数
      utterance.rate = options.rate ?? this.provider.settings.rate
      utterance.pitch = options.pitch ?? this.provider.settings.pitch
      utterance.volume = options.volume ?? this.provider.settings.volume

      // 设置语音
      if (options.voice || this.provider.settings.voice) {
        const voiceName = options.voice || this.provider.settings.voice
        const voice = speechSynthesis.getVoices().find((v) => v.name === voiceName)
        if (voice) {
          utterance.voice = voice
        }
      }

      // 事件监听
      utterance.onstart = () => {
        this._webSpeechIsPlaying = true
        this._webSpeechIsPaused = false
      }

      utterance.onend = () => {
        this._webSpeechIsPlaying = false
        this._webSpeechIsPaused = false
        resolve()
      }

      utterance.onpause = () => {
        this._webSpeechIsPaused = true
      }

      utterance.onresume = () => {
        this._webSpeechIsPaused = false
      }

      utterance.onerror = (event) => {
        this._webSpeechIsPlaying = false
        this._webSpeechIsPaused = false

        // 如果是由于停止操作导致的 interrupted 错误，不应该当作错误处理
        if (this._isStopping && event.error === 'interrupted') {
          this._isStopping = false
          resolve() // 正常结束
          return
        }

        reject(new Error(`Speech synthesis error: ${event.error}`))
      }
      speechSynthesis.speak(utterance)
    })
  }

  pause(): void {
    if ('speechSynthesis' in window && this._webSpeechIsPlaying && !this._webSpeechIsPaused) {
      speechSynthesis.pause()
    }
  }

  resume(): void {
    if ('speechSynthesis' in window && this._webSpeechIsPlaying && this._webSpeechIsPaused) {
      speechSynthesis.resume()
    }
  }

  stop(): void {
    if ('speechSynthesis' in window) {
      this._isStopping = true // 设置停止标志
      speechSynthesis.cancel()
      this._webSpeechIsPlaying = false
      this._webSpeechIsPaused = false
      // 注意：_isStopping 将在 onerror 事件中重置
    }
  }

  async check(): Promise<TTSCheckResult> {
    try {
      if (!('speechSynthesis' in window)) {
        return {
          valid: false,
          error: new Error('Speech synthesis not supported in this browser')
        }
      }

      // 检查是否有可用语音
      const voices = await this.getVoices()
      if (voices.length === 0) {
        return {
          valid: false,
          error: new Error('No voices available')
        }
      }

      return {
        valid: true,
        error: null
      }
    } catch (error) {
      return {
        valid: false,
        error: this.handleError(error)
      }
    }
  }

  isPlaying(): boolean {
    return this._webSpeechIsPlaying
  }

  isPaused(): boolean {
    return this._webSpeechIsPaused
  }

  protected getDefaultApiHost(): string {
    return '' // Web Speech API 不需要 API 主机
  }

  /**
   * 根据语音名称检测性别（简单的启发式方法）
   */
  private detectGender(voiceName: string): 'male' | 'female' | 'neutral' {
    const name = voiceName.toLowerCase()

    // 常见的男性语音名称
    const maleNames = ['male', 'man', 'david', 'alex', 'daniel', 'mark', 'tom', 'john', 'james']
    // 常见的女性语音名称
    const femaleNames = ['female', 'woman', 'samantha', 'victoria', 'karen', 'susan', 'anna', 'emma', 'sarah']

    for (const maleName of maleNames) {
      if (name.includes(maleName)) {
        return 'male'
      }
    }

    for (const femaleName of femaleNames) {
      if (name.includes(femaleName)) {
        return 'female'
      }
    }

    return 'neutral'
  }
}
