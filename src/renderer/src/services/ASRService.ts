import i18n from '@renderer/i18n'
import store from '@renderer/store'

/**
 * ASR服务，用于将语音转换为文本
 */
class ASRService {
  private mediaRecorder: MediaRecorder | null = null
  private audioChunks: Blob[] = []
  private isRecording = false
  private stream: MediaStream | null = null

  // WebSocket相关
  private ws: WebSocket | null = null
  private wsConnected = false
  private browserReady = false
  private reconnectAttempt = 0
  private maxReconnectAttempts = 5
  private reconnectTimeout: NodeJS.Timeout | null = null

  /**
   * 开始录音
   * @returns Promise<void>
   */
  /**
   * 连接到WebSocket服务器
   * @returns Promise<boolean> 是否连接成功
   */
  connectToWebSocketServer = async (): Promise<boolean> => {
    return new Promise((resolve) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        console.log('[ASRService] WebSocket已连接')
        resolve(true)
        return
      }

      if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
        console.log('[ASRService] WebSocket正在连接中')
        // 等待连接完成
        this.ws.onopen = () => {
          console.log('[ASRService] WebSocket连接成功')
          this.wsConnected = true
          this.reconnectAttempt = 0
          this.ws?.send(JSON.stringify({ type: 'identify', role: 'electron' }))
          resolve(true)
        }
        this.ws.onerror = () => {
          console.error('[ASRService] WebSocket连接失败')
          this.wsConnected = false
          resolve(false)
        }
        return
      }

      // 关闭之前的连接
      if (this.ws) {
        try {
          this.ws.close()
        } catch (e) {
          console.error('[ASRService] 关闭WebSocket连接失败:', e)
        }
      }

      // 创建新连接
      try {
        console.log('[ASRService] 正在连接WebSocket服务器...')
        window.message.loading({ content: '正在连接语音识别服务...', key: 'ws-connect' })

        this.ws = new WebSocket('ws://localhost:34515') // 使用正确的端口 34515
        this.wsConnected = false
        this.browserReady = false

        this.ws.onopen = () => {
          console.log('[ASRService] WebSocket连接成功')
          window.message.success({ content: '语音识别服务连接成功', key: 'ws-connect' })
          this.wsConnected = true
          this.reconnectAttempt = 0
          this.ws?.send(JSON.stringify({ type: 'identify', role: 'electron' }))
          resolve(true)
        }

        this.ws.onclose = () => {
          console.log('[ASRService] WebSocket连接关闭')
          this.wsConnected = false
          this.browserReady = false
          this.attemptReconnect()
        }

        this.ws.onerror = (error) => {
          console.error('[ASRService] WebSocket连接错误:', error)
          this.wsConnected = false
          window.message.error({ content: '语音识别服务连接失败', key: 'ws-connect' })
          resolve(false)
        }

        this.ws.onmessage = this.handleWebSocketMessage
      } catch (error) {
        console.error('[ASRService] 创建WebSocket连接失败:', error)
        window.message.error({ content: '语音识别服务连接失败', key: 'ws-connect' })
        resolve(false)
      }
    })
  }

  /**
   * 处理WebSocket消息
   */
  private handleWebSocketMessage = (event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data)
      console.log('[ASRService] 收到WebSocket消息:', data)

      if (data.type === 'status') {
        if (data.message === 'browser_ready' || data.message === 'Browser connected') {
          console.log('[ASRService] 浏览器已准备好')
          this.browserReady = true
          window.message.success({ content: '语音识别浏览器已准备好', key: 'browser-status' })
        } else if (data.message === 'Browser disconnected' || data.message === 'Browser connection error') {
          console.log('[ASRService] 浏览器断开连接')
          this.browserReady = false
          window.message.error({ content: '语音识别浏览器断开连接', key: 'browser-status' })
        } else if (data.message === 'stopped') {
          // 语音识别已停止
          console.log('[ASRService] 语音识别已停止')
          this.isRecording = false

          // 如果没有收到最终结果，显示处理完成消息
          window.message.success({ content: i18n.t('settings.asr.completed'), key: 'asr-processing' })
        } else if (data.message === 'reset_complete') {
          // 语音识别已重置
          console.log('[ASRService] 语音识别已强制重置')
          this.isRecording = false

          // 保存当前回调函数并立即清除
          const tempCallback = this.resultCallback
          this.resultCallback = null

          // 显示重置完成消息
          window.message.info({ content: '语音识别已重置', key: 'asr-reset' })

          // 如果有回调函数，调用一次空字符串，触发按钮状态重置
          if (tempCallback && typeof tempCallback === 'function') {
            // 使用空字符串调用回调，不会影响输入框，但可以触发按钮状态重置
            const callback = tempCallback as (text: string, isFinal?: boolean) => void // 明确指定类型
            setTimeout(() => {
              callback('', false)
            }, 100)
          }
        }
      } else if (data.type === 'result' && data.data) {
        // 处理识别结果
        console.log('[ASRService] 收到识别结果:', data.data)

        // 如果已经停止录音但仍然收到结果，检查是否是最终结果
        if (!this.isRecording && !data.data.isFinal) {
          console.log('[ASRService] 已停止录音但收到非最终结果，忽略')
          return
        }

        if (this.resultCallback && typeof this.resultCallback === 'function') {
          // 将所有结果都传递给回调函数，并包含isFinal状态
          if (data.data.text && data.data.text.trim()) {
            if (data.data.isFinal) {
              console.log('[ASRService] 收到最终结果，调用回调函数，文本:', data.data.text)

              // 不再清除回调函数，允许继续处理后续语音
              // const tempCallback = this.resultCallback
              // this.resultCallback = null

              // 直接调用回调函数
              this.resultCallback(data.data.text, true)
              window.message.success({ content: i18n.t('settings.asr.success'), key: 'asr-processing' })
            } else if (this.isRecording) {
              // 只在录音中才处理中间结果
              // 非最终结果，也调用回调，但标记为非最终
              console.log('[ASRService] 收到中间结果，调用回调函数，文本:', data.data.text)
              this.resultCallback(data.data.text, false)
            }
          } else {
            console.log('[ASRService] 识别结果为空，不调用回调')
          }
        } else {
          console.warn('[ASRService] 没有设置结果回调函数')
        }
      } else if (data.type === 'error') {
        console.error('[ASRService] 收到错误消息:', data.message || data.data)
        window.message.error({
          content: `语音识别错误: ${data.message || data.data?.error || '未知错误'}`,
          key: 'asr-error'
        })
      }
    } catch (error) {
      console.error('[ASRService] 解析WebSocket消息失败:', error, event.data)
    }
  }

  /**
   * 尝试重新连接WebSocket服务器
   */
  private attemptReconnect = () => {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }

    if (this.reconnectAttempt >= this.maxReconnectAttempts) {
      console.log('[ASRService] 达到最大重连次数，停止重连')
      return
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempt), 30000)
    console.log(
      `[ASRService] 将在 ${delay}ms 后尝试重连 (尝试 ${this.reconnectAttempt + 1}/${this.maxReconnectAttempts})`
    )

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectAttempt++
      this.connectToWebSocketServer().catch(console.error)
    }, delay)
  }

  // 存储结果回调函数
  resultCallback: ((text: string, isFinal?: boolean) => void) | null = null

  startRecording = async (onTranscribed?: (text: string, isFinal?: boolean) => void): Promise<void> => {
    try {
      const { asrEnabled, asrServiceType } = store.getState().settings

      if (!asrEnabled) {
        window.message.error({ content: i18n.t('settings.asr.error.not_enabled'), key: 'asr-error' })
        return
      }

      // 检查是否已经在录音
      if (this.isRecording) {
        console.log('已经在录音中，忽略此次请求')
        return
      }

      // 先设置回调函数，确保在任何情况下都能正确设置
      if (onTranscribed && typeof onTranscribed === 'function') {
        console.log('[ASRService] 设置结果回调函数')
        this.resultCallback = onTranscribed
      } else {
        console.warn('[ASRService] 未提供有效的回调函数')
      }

      // 如果是使用本地服务器
      if (asrServiceType === 'local') {
        // 连接WebSocket服务器
        const connected = await this.connectToWebSocketServer()
        if (!connected) {
          throw new Error('无法连接到语音识别服务')
        }

        // 获取语言设置
        const { asrLanguage } = store.getState().settings

        // 检查浏览器是否准备好
        if (!this.browserReady) {
          // 尝试等待浏览器准备好
          let waitAttempts = 0
          const maxWaitAttempts = 5

          // 尝试打开浏览器页面
          try {
            // 发送消息提示用户
            window.message.info({
              content: '正在准备语音识别服务...',
              key: 'browser-status'
            })

            // 尝试自动打开浏览器页面
            try {
              // 使用ASRServerService获取服务器URL
              const serverUrl = 'http://localhost:34515' // 使用正确的端口 34515
              console.log('尝试打开语音识别服务器页面:', serverUrl)
              window.open(serverUrl, '_blank')
            } catch (error) {
              console.error('获取服务器URL失败:', error)
            }
          } catch (error) {
            console.error('打开语音识别浏览器页面失败:', error)
          }

          while (!this.browserReady && waitAttempts < maxWaitAttempts) {
            window.message.loading({
              content: `等待浏览器准备就绪 (${waitAttempts + 1}/${maxWaitAttempts})...`,
              key: 'browser-status'
            })

            // 等待一秒
            await new Promise((resolve) => setTimeout(resolve, 1000))
            waitAttempts++
          }

          if (!this.browserReady) {
            window.message.warning({
              content: '语音识别浏览器尚未准备好，请确保已打开浏览器页面',
              key: 'browser-status'
            })
            throw new Error('浏览器尚未准备好')
          }
        }

        // 发送开始命令
        if (this.ws && this.wsConnected) {
          // 将语言设置传递给服务器
          this.ws.send(
            JSON.stringify({
              type: 'start',
              language: asrLanguage || 'zh-CN' // 使用设置的语言或默认中文
            })
          )
          this.isRecording = true
          console.log('开始语音识别，语言：', asrLanguage || 'zh-CN')
          window.message.info({ content: i18n.t('settings.asr.recording'), key: 'asr-recording' })
        } else {
          throw new Error('WebSocket连接未就绪')
        }
        return
      }

      // 以下是原有的录音逻辑（OpenAI或浏览器API）
      // 请求麦克风权限
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })

      // 创建MediaRecorder实例
      this.mediaRecorder = new MediaRecorder(this.stream)

      // 清空之前的录音数据
      this.audioChunks = []

      // 设置数据可用时的回调
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data)
        }
      }

      // 开始录音
      this.mediaRecorder.start()
      this.isRecording = true

      console.log('开始录音')
      window.message.info({ content: i18n.t('settings.asr.recording'), key: 'asr-recording' })
    } catch (error) {
      console.error('开始录音失败:', error)
      window.message.error({
        content: i18n.t('settings.asr.error.start_failed') + ': ' + (error as Error).message,
        key: 'asr-error'
      })
      this.isRecording = false
    }
  }

  /**
   * 停止录音并转换为文本
   * @param onTranscribed 转录完成后的回调函数
   * @returns Promise<void>
   */
  stopRecording = async (onTranscribed: (text: string, isFinal?: boolean) => void): Promise<void> => {
    const { asrServiceType } = store.getState().settings

    // 如果是使用本地服务器
    if (asrServiceType === 'local') {
      if (!this.isRecording) {
        console.log('没有正在进行的语音识别')
        return
      }

      try {
        // 保存回调函数
        this.resultCallback = onTranscribed

        // 发送停止命令
        if (this.ws && this.wsConnected) {
          this.ws.send(JSON.stringify({ type: 'stop' }))
          console.log('停止语音识别')
          window.message.loading({ content: i18n.t('settings.asr.processing'), key: 'asr-processing' })

          // 立即调用回调函数，使按钮状态立即更新
          if (onTranscribed) {
            // 使用空字符串调用回调，不会影响输入框，但可以触发按钮状态重置
            // 传递false表示这不是最终结果，只是状态更新
            setTimeout(() => {
              onTranscribed('', false)
            }, 100)
          }

          // 不再清除回调函数，允许连续说多句话
          // setTimeout(() => {
          //   // 在停止后的一段时间内清除回调，防止后续结果被处理
          //   this.resultCallback = null
          // }, 3000) // 3秒后清除回调
        } else {
          throw new Error('WebSocket连接未就绪')
        }

        // 重置录音状态
        this.isRecording = false
      } catch (error) {
        console.error('停止语音识别失败:', error)
        window.message.error({
          content: i18n.t('settings.asr.error.transcribe_failed') + ': ' + (error as Error).message,
          key: 'asr-processing'
        })
        this.isRecording = false
      }
      return
    }

    // 以下是原有的录音停止逻辑（OpenAI或浏览器API）
    if (!this.isRecording || !this.mediaRecorder) {
      console.log('没有正在进行的录音')
      return
    }

    try {
      // 创建一个Promise，等待录音结束
      const recordingEndedPromise = new Promise<Blob>((resolve) => {
        if (this.mediaRecorder) {
          this.mediaRecorder.onstop = () => {
            // 将所有音频块合并为一个Blob
            const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' })
            resolve(audioBlob)
          }

          // 停止录音
          this.mediaRecorder.stop()
        }
      })

      // 停止所有轨道
      if (this.stream) {
        this.stream.getTracks().forEach((track) => track.stop())
        this.stream = null
      }

      // 等待录音结束并获取音频Blob
      const audioBlob = await recordingEndedPromise

      // 重置录音状态
      this.isRecording = false
      this.mediaRecorder = null

      console.log('录音结束，音频大小:', audioBlob.size, 'bytes')

      // 显示处理中消息
      window.message.loading({ content: i18n.t('settings.asr.processing'), key: 'asr-processing' })

      if (asrServiceType === 'openai') {
        // 使用OpenAI的Whisper API进行语音识别
        await this.transcribeWithOpenAI(audioBlob, onTranscribed)
      } else if (asrServiceType === 'browser') {
        // 使用浏览器的Web Speech API进行语音识别
        await this.transcribeWithBrowser(audioBlob, onTranscribed)
      } else {
        throw new Error(`不支持的ASR服务类型: ${asrServiceType}`)
      }
    } catch (error) {
      console.error('停止录音或转录失败:', error)
      window.message.error({
        content: i18n.t('settings.asr.error.transcribe_failed') + ': ' + (error as Error).message,
        key: 'asr-processing'
      })

      // 重置录音状态
      this.isRecording = false
      this.mediaRecorder = null
      if (this.stream) {
        this.stream.getTracks().forEach((track) => track.stop())
        this.stream = null
      }
    }
  }

  /**
   * 使用OpenAI的Whisper API进行语音识别
   * @param audioBlob 音频Blob
   * @param onTranscribed 转录完成后的回调函数
   * @returns Promise<void>
   */
  private transcribeWithOpenAI = async (audioBlob: Blob, onTranscribed: (text: string) => void): Promise<void> => {
    try {
      const { asrApiKey, asrApiUrl, asrModel } = store.getState().settings

      if (!asrApiKey) {
        throw new Error(i18n.t('settings.asr.error.no_api_key'))
      }

      // 创建FormData对象
      const formData = new FormData()
      formData.append('file', audioBlob, 'recording.webm')
      formData.append('model', asrModel || 'whisper-1')

      // 调用OpenAI API
      const response = await fetch(asrApiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${asrApiKey}`
        },
        body: formData
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error?.message || 'OpenAI语音识别失败')
      }

      // 解析响应
      const data = await response.json()
      const transcribedText = data.text

      if (transcribedText) {
        console.log('语音识别成功:', transcribedText)
        window.message.success({ content: i18n.t('settings.asr.success'), key: 'asr-processing' })
        onTranscribed(transcribedText)
      } else {
        throw new Error('未能识别出文本')
      }
    } catch (error) {
      console.error('OpenAI语音识别失败:', error)
      throw error
    }
  }

  /**
   * 使用浏览器的Web Speech API进行语音识别
   * @param audioBlob 音频Blob
   * @param onTranscribed 转录完成后的回调函数
   * @returns Promise<void>
   */
  private transcribeWithBrowser = async (_audioBlob: Blob, onTranscribed: (text: string) => void): Promise<void> => {
    try {
      // 检查浏览器是否支持Web Speech API
      if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        throw new Error(i18n.t('settings.asr.error.browser_not_support'))
      }

      // 由于Web Speech API不支持直接处理录制的音频，这里我们只是模拟一个成功的回调
      // 实际上，使用Web Speech API时，应该直接使用SpeechRecognition对象进行实时识别
      // 这里简化处理，实际项目中可能需要更复杂的实现
      window.message.success({ content: i18n.t('settings.asr.success'), key: 'asr-processing' })
      onTranscribed('浏览器语音识别功能尚未完全实现')
    } catch (error) {
      console.error('浏览器语音识别失败:', error)
      throw error
    }
  }

  /**
   * 检查是否正在录音
   * @returns boolean
   */
  isCurrentlyRecording = (): boolean => {
    return this.isRecording
  }

  /**
   * 检查WebSocket是否已连接
   * @returns boolean
   */
  isWebSocketConnected = (): boolean => {
    return this.wsConnected && this.browserReady
  }

  /**
   * 取消录音
   */
  cancelRecording = (): void => {
    const { asrServiceType } = store.getState().settings

    // 如果是使用本地服务器
    if (asrServiceType === 'local') {
      // 修改条件，即使不在录音中也进行重置
      if (this.isRecording || this.resultCallback) {
        // 先重置状态和回调，确保不会处理后续结果
        this.isRecording = false
        this.resultCallback = null

        // 发送停止命令
        if (this.ws && this.wsConnected) {
          this.ws.send(JSON.stringify({ type: 'stop' }))
          console.log('发送停止命令到WebSocket服务器')

          // 发送一个额外的命令，要求浏览器强制重置语音识别
          setTimeout(() => {
            if (this.ws && this.wsConnected) {
              this.ws.send(JSON.stringify({ type: 'reset' }))
              console.log('发送重置命令到WebSocket服务器')
            }
          }, 100)
        }

        console.log('语音识别已取消')
        window.message.info({ content: i18n.t('settings.asr.canceled'), key: 'asr-recording' })
      }
      return
    }

    // 以下是原有的取消录音逻辑（OpenAI或浏览器API）
    if (this.isRecording && this.mediaRecorder) {
      // 停止MediaRecorder
      this.mediaRecorder.stop()

      // 停止所有轨道
      if (this.stream) {
        this.stream.getTracks().forEach((track) => track.stop())
        this.stream = null
      }

      // 重置状态
      this.isRecording = false
      this.mediaRecorder = null
      this.audioChunks = []

      console.log('录音已取消')
      window.message.info({ content: i18n.t('settings.asr.canceled'), key: 'asr-recording' })
    }
  }

  /**
   * 关闭WebSocket连接
   */
  closeWebSocketConnection = (): void => {
    if (this.ws) {
      try {
        this.ws.close()
      } catch (e) {
        console.error('[ASRService] 关闭WebSocket连接失败:', e)
      }
      this.ws = null
    }

    this.wsConnected = false
    this.browserReady = false

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }
  }

  /**
   * 打开浏览器页面
   */
  openBrowserPage = (): void => {
    // 使用window.open打开浏览器页面
    window.open('http://localhost:34515', '_blank') // 使用正确的端口 34515
  }
}

// 创建单例实例
const instance = new ASRService()
export default instance
