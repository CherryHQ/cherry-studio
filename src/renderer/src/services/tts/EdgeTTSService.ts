import i18n from '@renderer/i18n'

import { TTSServiceInterface } from './TTSServiceInterface'

// 全局变量来跟踪当前正在播放的语音
let currentUtterance: SpeechSynthesisUtterance | null = null

// 全局变量来跟踪是否正在播放
export let isEdgeTTSPlaying = false

/**
 * Edge TTS服务实现类
 */
export class EdgeTTSService implements TTSServiceInterface {
  private edgeVoice: string

  /**
   * 构造函数
   * @param edgeVoice Edge语音
   */
  constructor(edgeVoice: string) {
    this.edgeVoice = edgeVoice
    console.log('初始化EdgeTTSService，语音:', edgeVoice)
  }

  /**
   * 验证参数
   * @throws 如果参数无效，抛出错误
   */
  private validateParams(): void {
    if (!this.edgeVoice) {
      throw new Error(i18n.t('settings.tts.error.no_edge_voice'))
    }
  }

  /**
   * 直接播放语音
   * @param text 要播放的文本
   * @returns 是否成功播放
   */
  private playDirectly(text: string): boolean {
    try {
      // 验证参数
      this.validateParams()

      // 使用Web Speech API
      if (!('speechSynthesis' in window)) {
        throw new Error(i18n.t('settings.tts.error.browser_not_support'))
      }

      // 停止当前正在播放的语音
      window.speechSynthesis.cancel()
      if (currentUtterance) {
        currentUtterance = null
      }
      isEdgeTTSPlaying = false

      // 创建语音合成器实例
      const utterance = new SpeechSynthesisUtterance(text)
      currentUtterance = utterance
      isEdgeTTSPlaying = true

      // 获取可用的语音合成声音
      const voices = window.speechSynthesis.getVoices()
      console.log('可用的语音合成声音:', voices)

      // 查找指定的语音
      let selectedVoice = voices.find((v) => v.name === this.edgeVoice)

      // 如果没有找到指定的语音，尝试使用中文语音
      if (!selectedVoice) {
        console.warn('未找到指定的语音:', this.edgeVoice)
        // 尝试找中文语音
        selectedVoice = voices.find((v) => v.lang === 'zh-CN')

        if (selectedVoice) {
          console.log('使用替代中文语音:', selectedVoice.name)
        } else {
          // 如果没有中文语音，使用第一个可用的语音
          if (voices.length > 0) {
            selectedVoice = voices[0]
            console.log('使用第一个可用的语音:', selectedVoice.name)
          } else {
            console.warn('没有可用的语音')
            return false
          }
        }
      } else {
        console.log('已选择语音:', selectedVoice.name)
      }

      // 设置语音
      if (selectedVoice) {
        utterance.voice = selectedVoice
      }

      // 设置事件处理程序
      utterance.onend = () => {
        console.log('语音合成已结束')
        currentUtterance = null
        isEdgeTTSPlaying = false

        // 分发一个自定义事件，通知语音合成已结束
        // 这样TTSService可以监听这个事件并重置播放状态
        const event = new CustomEvent('edgeTTSComplete', { detail: { text } })
        document.dispatchEvent(event)
      }

      utterance.onerror = (errorEvent) => {
        console.error('语音合成错误:', errorEvent)
        currentUtterance = null
        isEdgeTTSPlaying = false

        // 在错误时也触发结束事件，确保状态更新
        const completeEvent = new CustomEvent('edgeTTSComplete', { detail: { text, error: true } })
        document.dispatchEvent(completeEvent)
      }

      // 开始语音合成
      window.speechSynthesis.speak(utterance)
      return true
    } catch (error) {
      console.error('直接播放语音失败:', error)
      return false
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

    // 先尝试直接播放
    const playResult = this.playDirectly(text)
    if (playResult) {
      // 如果直接播放成功，返回一个有效的音频Blob
      // 创建一个简单的音频文件，包含一个短暂停
      // 这个文件可以被浏览器正常播放，但实际上不会发出声音
      // 因为我们已经使用Web Speech API直接播放了语音
      const silentAudioBase64 = 'UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA='
      const silentAudioBuffer = Uint8Array.from(atob(silentAudioBase64), (c) => c.charCodeAt(0))
      return new Blob([silentAudioBuffer], { type: 'audio/wav' })
    }

    // 如果直接播放失败，尝试录制方法
    console.log('直接播放失败，尝试录制方法')
    try {
      console.log('使用浏览器TTS生成语音，音色:', this.edgeVoice)

      // 使用Web Speech API
      if (!('speechSynthesis' in window)) {
        throw new Error(i18n.t('settings.tts.error.browser_not_support'))
      }

      // 停止当前正在播放的语音
      window.speechSynthesis.cancel()
      isEdgeTTSPlaying = false

      // 创建语音合成器实例
      const utterance = new SpeechSynthesisUtterance(text)

      // 获取可用的语音合成声音
      const voices = window.speechSynthesis.getVoices()
      console.log('初始可用的语音合成声音:', voices)

      // 如果没有可用的声音，等待声音加载
      if (voices.length === 0) {
        try {
          await new Promise<void>((resolve) => {
            const voicesChangedHandler = () => {
              window.speechSynthesis.onvoiceschanged = null
              resolve()
            }
            window.speechSynthesis.onvoiceschanged = voicesChangedHandler

            // 设置超时，防止无限等待
            setTimeout(() => {
              window.speechSynthesis.onvoiceschanged = null
              resolve()
            }, 5000)
          })
        } catch (error) {
          console.error('等待语音加载超时:', error)
        }
      }

      // 重新获取可用的语音合成声音
      const updatedVoices = window.speechSynthesis.getVoices()
      console.log('更新后可用的语音合成声音:', updatedVoices)

      // 查找指定的语音
      let selectedVoice = updatedVoices.find((v) => v.name === this.edgeVoice)

      // 如果没有找到指定的语音，尝试使用中文语音
      if (!selectedVoice) {
        console.warn('未找到指定的语音:', this.edgeVoice)
        // 尝试找中文语音
        selectedVoice = updatedVoices.find((v) => v.lang === 'zh-CN')

        if (selectedVoice) {
          console.log('使用替代中文语音:', selectedVoice.name)
        } else {
          // 如果没有中文语音，使用第一个可用的语音
          if (updatedVoices.length > 0) {
            selectedVoice = updatedVoices[0]
            console.log('使用第一个可用的语音:', selectedVoice.name)
          } else {
            console.warn('没有可用的语音')
          }
        }
      } else {
        console.log('已选择语音:', selectedVoice.name)
      }

      // 设置语音
      if (selectedVoice) {
        utterance.voice = selectedVoice
      }

      // 创建一个Promise来等待语音合成完成
      return await new Promise<Blob>((resolve, reject) => {
        try {
          // 使用AudioContext捕获语音合成的音频
          const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
          const audioDestination = audioContext.createMediaStreamDestination()
          const mediaRecorder = new MediaRecorder(audioDestination.stream)
          const audioChunks: BlobPart[] = []

          mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
              audioChunks.push(event.data)
            }
          }

          mediaRecorder.onstop = () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/wav' })
            resolve(audioBlob)
          }

          // 开始录制
          mediaRecorder.start()

          // 设置语音合成事件
          utterance.onend = () => {
            // 语音合成结束后停止录制
            setTimeout(() => {
              mediaRecorder.stop()
            }, 500) // 等待一下，确保所有音频都被捕获
          }

          utterance.onerror = (event) => {
            console.error('语音合成错误:', event)
            mediaRecorder.stop()
            reject(new Error('语音合成错误'))
          }

          // 开始语音合成
          window.speechSynthesis.speak(utterance)

          // 设置超时，防止无限等待
          setTimeout(() => {
            if (mediaRecorder.state === 'recording') {
              console.warn('语音合成超时，强制停止')
              mediaRecorder.stop()
            }
          }, 10000) // 10秒超时
        } catch (error: any) {
          console.error('浏览器TTS语音合成失败:', error)
          reject(new Error(`浏览器TTS语音合成失败: ${error?.message || '未知错误'}`))
        }
      })
    } catch (error: any) {
      console.error('浏览器TTS语音合成失败:', error)
      // 即使失败也返回一个空的Blob，而不是抛出异常
      // 这样可以避免在UI上显示错误消息
      return new Blob([], { type: 'audio/wav' })
    }
  }
}
