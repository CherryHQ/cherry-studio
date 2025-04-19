import { DEFAULT_VOICE_CALL_PROMPT } from '@renderer/config/prompts'
import { fetchChatCompletion } from '@renderer/services/ApiService'
import ASRService from '@renderer/services/ASRService'
import { getDefaultAssistant } from '@renderer/services/AssistantService'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { getAssistantMessage, getUserMessage } from '@renderer/services/MessagesService'
import TTSService from '@renderer/services/TTSService'
import store from '@renderer/store'
import { setSkipNextAutoTTS } from '@renderer/store/settings'
// 导入类型
import type { Message } from '@renderer/types'
import i18n from 'i18next'

interface VoiceCallCallbacks {
  onTranscript: (text: string) => void
  onResponse: (text: string) => void
  onListeningStateChange: (isListening: boolean) => void
  onSpeakingStateChange: (isSpeaking: boolean) => void
}

// 为TypeScript添加SpeechRecognition类型
declare global {
  interface Window {
    SpeechRecognition: any
    webkitSpeechRecognition: any
  }
}

class VoiceCallServiceClass {
  private recognition: any = null
  private isCallActive = false
  private isRecording = false // 新增录音状态
  private isMuted = false
  private isPaused = false
  private callbacks: VoiceCallCallbacks | null = null
  private _currentTranscript = '' // 使用下划线前缀避免未使用警告
  private _accumulatedTranscript = '' // 累积的语音识别结果
  private conversationHistory: { role: string; content: string }[] = []
  private isProcessingResponse = false
  private ttsService = TTSService
  private recordingTimeout: NodeJS.Timeout | null = null // 录音超时定时器

  async initialize() {
    // 检查麦克风权限
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((track) => track.stop())
    } catch (error) {
      console.error('Microphone permission denied:', error)
      throw new Error('Microphone permission denied')
    }

    // 获取当前ASR服务类型
    const { asrServiceType } = store.getState().settings

    // 如果使用浏览器ASR，检查浏览器支持
    if (asrServiceType === 'browser') {
      if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        throw new Error('Speech recognition not supported in this browser')
      }

      // 初始化浏览器语音识别
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
      this.recognition = new SpeechRecognition()
      this.recognition.continuous = true
      this.recognition.interimResults = true
      this.recognition.lang = navigator.language || 'zh-CN'
    } else if (asrServiceType === 'local') {
      // 如果使用本地服务器ASR，检查连接
      try {
        // 尝试连接本地ASR服务器
        console.log('初始化时尝试连接语音识别服务器')
        const connected = await ASRService.connectToWebSocketServer()
        if (!connected) {
          console.warn('无法连接到语音识别服务，将在需要时重试')
          // 不抛出异常，允许程序继续运行，在需要时重试
        } else {
          console.log('语音识别服务器连接成功')
        }
      } catch (error) {
        console.error('连接语音识别服务器失败:', error)
        // 不抛出异常，允许程序继续运行，在需要时重试
      }
    }

    return true
  }

  async startCall(callbacks: VoiceCallCallbacks) {
    this.callbacks = callbacks
    this.isCallActive = true
    this.conversationHistory = []

    // 获取当前ASR服务类型
    const { asrServiceType } = store.getState().settings

    // 如果是本地服务器ASR，预先连接服务器
    if (asrServiceType === 'local') {
      try {
        // 尝试连接WebSocket服务器
        console.log('通话开始，预先连接语音识别服务器')
        const connected = await ASRService.connectToWebSocketServer()
        if (!connected) {
          console.warn('无法连接到语音识别服务器，将在需要时重试')
        } else {
          console.log('语音识别服务器连接成功')
        }
      } catch (error) {
        console.error('连接语音识别服务器失败:', error)
      }
    }

    // 根据不同的ASR服务类型进行初始化
    if (asrServiceType === 'browser') {
      if (!this.recognition) {
        throw new Error('Browser speech recognition not initialized')
      }

      // 设置浏览器语音识别事件处理
      this.recognition.onresult = (event: any) => {
        let interimTranscript = ''
        let finalTranscript = ''

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript
          } else {
            interimTranscript += event.results[i][0].transcript
          }
        }

        if (interimTranscript) {
          // 更新当前的临时识别结果
          this._currentTranscript = interimTranscript
          // 显示累积结果 + 当前临时结果
          this.callbacks?.onTranscript(this._accumulatedTranscript + ' ' + interimTranscript)
        }

        if (finalTranscript) {
          // 将最终结果累积到总结果中
          if (this._accumulatedTranscript) {
            // 如果已经有累积的文本，添加空格再追加
            this._accumulatedTranscript += ' ' + finalTranscript
          } else {
            // 如果是第一段文本，直接设置
            this._accumulatedTranscript = finalTranscript
          }

          // 更新当前的识别结果
          this._currentTranscript = ''
          // 显示累积的完整结果
          this.callbacks?.onTranscript(this._accumulatedTranscript)

          // 在录音过程中只更新transcript，不触发handleUserSpeech
          // 松开按钮后才会处理完整的录音内容
        }
      }

      this.recognition.onstart = () => {
        this.isRecording = true
        this.callbacks?.onListeningStateChange(true)
      }

      this.recognition.onend = () => {
        this.isRecording = false
        this.callbacks?.onListeningStateChange(false)
      }

      this.recognition.onerror = (event: any) => {
        console.error('Speech recognition error', event.error)
        this.isRecording = false
        this.callbacks?.onListeningStateChange(false)
      }
    }

    // 设置skipNextAutoTTS为true，防止自动播放最后一条消息
    store.dispatch(setSkipNextAutoTTS(true))

    // 播放欢迎语音 - 根据当前语言获取本地化的欢迎消息
    const welcomeMessage = i18n.t('settings.voice_call.welcome_message')
    // 不调用onResponse，避免触发两次TTS播放
    // this.callbacks?.onResponse(welcomeMessage)

    // 监听TTS状态
    const ttsStateHandler = (isPlaying: boolean) => {
      this.callbacks?.onSpeakingStateChange(isPlaying)
    }

    // 监听TTS播放状态
    window.addEventListener('tts-state-change', (event: any) => {
      ttsStateHandler(event.detail.isPlaying)
    })

    // 播放欢迎语音，并手动设置初始状态
    this.callbacks?.onSpeakingStateChange(true)
    this.ttsService.speak(welcomeMessage)

    // 确保欢迎语音结束后状态正确
    setTimeout(() => {
      if (this.ttsService && !this.ttsService.isCurrentlyPlaying()) {
        this.callbacks?.onSpeakingStateChange(false)
      }
    }, 5000) // 5秒后检查TTS状态

    return true
  }

  /**
   * 开始录音
   * @returns Promise<boolean> 是否成功开始录音
   */
  async startRecording(): Promise<boolean> {
    if (!this.isCallActive || this.isPaused || this.isProcessingResponse || this.isRecording) {
      return false
    }

    // 重置累积的文本
    this._accumulatedTranscript = ''

    // 获取当前ASR服务类型
    const { asrServiceType } = store.getState().settings

    try {
      if (asrServiceType === 'browser') {
        // 浏览器ASR
        if (!this.recognition) {
          throw new Error('Browser speech recognition not initialized')
        }

        this.recognition.start()
        this.isRecording = true
      } else if (asrServiceType === 'local') {
        // 本地服务器ASR
        try {
          // 先检查连接状态，如果未连接则尝试重新连接
          if (!ASRService.isWebSocketConnected()) {
            console.log('语音识别服务器未连接，尝试重新连接')
            const connected = await ASRService.connectToWebSocketServer()
            if (!connected) {
              throw new Error('无法连接到语音识别服务器')
            }

            // 等待一下，确保连接已建立
            await new Promise((resolve) => setTimeout(resolve, 500))
          }

          // 开始录音
          await ASRService.startRecording((text, isFinal) => {
            if (text) {
              if (isFinal) {
                // 如果是最终结果，累积到总结果中
                if (this._accumulatedTranscript) {
                  // 如果已经有累积的文本，添加空格再追加
                  this._accumulatedTranscript += ' ' + text
                } else {
                  // 如果是第一段文本，直接设置
                  this._accumulatedTranscript = text
                }

                // 更新当前的识别结果
                this._currentTranscript = ''
                // 显示累积的完整结果
                this.callbacks?.onTranscript(this._accumulatedTranscript)
              } else {
                // 如果是临时结果，更新当前的识别结果
                this._currentTranscript = text
                // 只显示当前临时结果，不与累积结果拼接
                this.callbacks?.onTranscript(text)
              }

              // 在录音过程中只更新transcript，不触发handleUserSpeech
              // 松开按钮后才会处理完整的录音内容
            }
          })

          this.isRecording = true
          this.callbacks?.onListeningStateChange(true)
        } catch (error) {
          console.error('启动语音识别失败:', error)
          throw error
        }
      } else if (asrServiceType === 'openai') {
        // OpenAI ASR
        await ASRService.startRecording()
        this.isRecording = true
        this.callbacks?.onListeningStateChange(true)
      }

      // 设置最长录音时间，防止用户忘记松开
      this.recordingTimeout = setTimeout(() => {
        if (this.isRecording) {
          this.stopRecording()
        }
      }, 60000) // 60秒最长录音时间

      return true
    } catch (error) {
      console.error('Failed to start recording:', error)
      this.isRecording = false
      this.callbacks?.onListeningStateChange(false)
      return false
    }
  }

  /**
   * 停止录音并处理结果，将录音内容发送给AI
   * @returns Promise<boolean> 是否成功停止录音
   */
  async stopRecording(): Promise<boolean> {
    if (!this.isCallActive || !this.isRecording) {
      return false
    }

    // 清除录音超时定时器
    if (this.recordingTimeout) {
      clearTimeout(this.recordingTimeout)
      this.recordingTimeout = null
    }

    // 获取当前ASR服务类型
    const { asrServiceType } = store.getState().settings

    try {
      // 立即设置录音状态为false，防止重复处理
      this.isRecording = false
      this.callbacks?.onListeningStateChange(false)

      // 存储当前的语音识别结果，用于松开按钮后发送给AI
      const currentTranscript = this._currentTranscript
      // 存储累积的语音识别结果
      const accumulatedTranscript = this._accumulatedTranscript

      if (asrServiceType === 'browser') {
        // 浏览器ASR
        if (!this.recognition) {
          throw new Error('Browser speech recognition not initialized')
        }

        this.recognition.stop()

        // 优先使用累积的文本，如果有的话
        if (accumulatedTranscript) {
          console.log('发送累积的语音识别结果给AI:', accumulatedTranscript)
          this.handleUserSpeech(accumulatedTranscript)
        } else if (currentTranscript) {
          // 如果没有累积结果，使用当前结果
          console.log('没有累积结果，使用当前结果:', currentTranscript)
          this.handleUserSpeech(currentTranscript)
        }

        // 清除状态
        this._currentTranscript = ''
        this._accumulatedTranscript = ''
      } else if (asrServiceType === 'local') {
        // 本地服务器ASR
        // 创建一个承诺，等待最终结果
        const finalResultPromise = new Promise<string>((resolve) => {
          // 设置一个超时器，确保不会无限等待
          const timeoutId = setTimeout(() => {
            console.log('等待最终结果超时，使用当前结果')
            resolve(this._currentTranscript)
          }, 1500) // 1.5秒超时

          // 设置回调函数来接收最终结果
          const resultCallback = (text: string, isFinal?: boolean) => {
            // 如果是空字符串，表示只是重置状态，不处理
            if (text === '') return

            if (text) {
              // 只处理最终结果，忽略中间结果
              if (isFinal) {
                clearTimeout(timeoutId)
                console.log('收到最终语音识别结果:', text)
                this._currentTranscript = text
                this.callbacks?.onTranscript(text)
                resolve(text)
              } else {
                // 对于中间结果，只更新显示，不解析Promise
                console.log('收到中间语音识别结果:', text)
                this.callbacks?.onTranscript(text)
              }
            }
          }

          // 停止录音，但不取消，以获取最终结果
          ASRService.stopRecording(resultCallback)

          // 添加额外的安全措施，在停止后立即发送重置命令
          setTimeout(() => {
            // 发送重置命令，确保浏览器不会继续发送结果
            ASRService.cancelRecording()

            // 清除ASRService中的回调函数，防止后续结果被处理
            ASRService.resultCallback = null
          }, 2000) // 2秒后强制取消，作为安全措施
        })

        // 等待最终结果，但最多等待3秒
        const finalText = await finalResultPromise

        // 优先使用累积的文本，如果有的话
        if (accumulatedTranscript) {
          console.log('发送累积的语音识别结果给AI:', accumulatedTranscript)
          this.handleUserSpeech(accumulatedTranscript)
        } else if (finalText) {
          // 如果没有累积结果，使用最终结果
          console.log('发送最终语音识别结果给AI:', finalText)
          this.handleUserSpeech(finalText)
        } else if (currentTranscript) {
          // 如果没有最终结果，使用当前结果
          console.log('没有最终结果，使用当前结果:', currentTranscript)
          this.handleUserSpeech(currentTranscript)
        }

        // 再次确保所有状态被重置
        this._currentTranscript = ''
        this._accumulatedTranscript = ''
      } else if (asrServiceType === 'openai') {
        // OpenAI ASR
        await ASRService.stopRecording((text) => {
          // 更新最终的语音识别结果
          if (text) {
            this._currentTranscript = text
            this.callbacks?.onTranscript(text)
          }
        })

        // 使用最新的语音识别结果
        const finalTranscript = this._currentTranscript
        if (finalTranscript) {
          this.handleUserSpeech(finalTranscript)
        }

        // 清除状态
        this._currentTranscript = ''
        this._accumulatedTranscript = ''
      }

      return true
    } catch (error) {
      console.error('Failed to stop recording:', error)
      this.isRecording = false
      this.callbacks?.onListeningStateChange(false)

      // 确保在出错时也清除状态
      this._currentTranscript = ''
      this._accumulatedTranscript = ''

      // 强制取消录音
      ASRService.cancelRecording()

      return false
    }
  }

  /**
   * 处理用户语音输入
   * @param text 语音识别结果文本
   * @param sendToChat 是否将结果发送到聊天界面
   */
  async handleUserSpeech(text: string, sendToChat: boolean = false) {
    if (!this.isCallActive || this.isProcessingResponse || this.isPaused) return

    // 暂停语音识别，避免在AI回复时继续识别
    const { asrServiceType } = store.getState().settings
    if (asrServiceType === 'browser') {
      this.recognition?.stop()
    } else if (asrServiceType === 'local' || asrServiceType === 'openai') {
      ASRService.cancelRecording()
    }

    this.isProcessingResponse = true

    try {
      // 获取当前助手
      const assistant = getDefaultAssistant()

      // 检查是否有自定义模型
      const { voiceCallModel } = store.getState().settings
      if (voiceCallModel) {
        // 如果有自定义模型，覆盖默认助手的模型
        assistant.model = voiceCallModel
        console.log('设置语音通话专用模型:', JSON.stringify(voiceCallModel))
      } else {
        console.log('没有设置语音通话专用模型，使用默认助手模型:', JSON.stringify(assistant.model))
      }

      // 如果需要发送到聊天界面，触发事件
      if (sendToChat) {
        console.log('将语音识别结果发送到聊天界面:', text)

        try {
          // 获取语音通话专用模型
          const { voiceCallModel } = store.getState().settings

          // 打印日志查看模型信息
          console.log('语音通话专用模型:', voiceCallModel ? JSON.stringify(voiceCallModel) : 'null')
          console.log('助手模型:', assistant.model ? JSON.stringify(assistant.model) : 'null')

          // 准备要发送的模型
          const modelToUse = voiceCallModel || assistant.model

          // 确保模型对象完整
          if (modelToUse && typeof modelToUse === 'object') {
            console.log('使用完整模型对象:', modelToUse.name || modelToUse.id)
          } else {
            console.error('模型对象不完整或不存在')
          }

          // 直接触发事件，将语音识别结果发送到聊天界面
          // 优先使用语音通话专用模型，而不是助手模型
          const eventData = {
            text,
            model: modelToUse,
            isVoiceCall: true, // 标记这是语音通话消息
            useVoiceCallModel: true, // 明确标记使用语音通话模型
            voiceCallModelId: voiceCallModel?.id // 传递语音通话模型ID
          }

          // 打印完整的事件数据
          console.log('发送语音通话消息事件数据:', JSON.stringify(eventData))

          // 发送事件
          EventEmitter.emit(EVENT_NAMES.VOICE_CALL_MESSAGE, eventData)

          // 打印日志确认事件已触发
          console.log(
            '事件已触发，消息内容:',
            text,
            '模型:',
            voiceCallModel ? voiceCallModel.name : assistant.model?.name
          )

          // 使用消息通知用户
          window.message.success({ content: '语音识别已完成，正在发送消息...', key: 'voice-call-send' })
        } catch (error) {
          console.error('发送语音识别结果到聊天界面时出错:', error)
          window.message.error({ content: '发送语音识别结果失败', key: 'voice-call-error' })
        }

        // 不在这里处理响应，因为聊天界面会处理
        this.isProcessingResponse = false
        return
      }

      // 以下是原有的处理逻辑，用于独立的语音通话窗口
      // 创建一个简单的Topic对象
      const topic = {
        id: 'voice-call',
        assistantId: assistant.id,
        name: 'Voice Call',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: []
      }

      // 创建用户消息
      const userMessage = getUserMessage({
        assistant,
        topic,
        type: 'text',
        content: text
      })

      // 创建助手消息
      const assistantMessage = getAssistantMessage({
        assistant,
        topic
      })

      // 更新对话历史
      this.conversationHistory.push({ role: 'user', content: text })

      // 构建消息列表
      // 将历史消息转换为正确的Message对象
      const historyMessages = this.conversationHistory.map((msg) => {
        if (msg.role === 'user') {
          return getUserMessage({
            assistant,
            topic,
            type: 'text',
            content: msg.content
          })
        } else {
          const assistantMsg = getAssistantMessage({
            assistant,
            topic
          })
          return { ...assistantMsg, content: msg.content, status: 'success' }
        }
      })

      // 获取用户自定义提示词
      const { voiceCallPrompt } = store.getState().settings

      // 使用自定义提示词或默认提示词
      const promptToUse = voiceCallPrompt || DEFAULT_VOICE_CALL_PROMPT

      // 创建系统指令消息
      const systemMessage = {
        role: 'system',
        content: promptToUse
      }

      // 修改用户消息的内容
      userMessage.content = text

      // 构建最终消息列表
      // 使用类型断言解决类型问题
      const messages = [systemMessage, ...historyMessages, userMessage] as Message[]

      // 流式响应处理
      let fullResponse = ''

      try {
        // 调用真实的LLM API
        await fetchChatCompletion({
          message: assistantMessage,
          messages,
          assistant,
          onResponse: async (msg) => {
            if (msg.content && msg.content !== fullResponse) {
              fullResponse = msg.content

              // 更新UI
              this.callbacks?.onResponse(fullResponse)

              // 如果TTS正在播放，停止它
              if (this.ttsService.isCurrentlyPlaying()) {
                this.ttsService.stop()
              }
            }
          }
        })

        // 播放完整响应
        if (!this.isMuted && this.isCallActive) {
          // 手动设置语音状态
          this.callbacks?.onSpeakingStateChange(true)

          // 添加TTS状态变化事件监听器
          const handleTTSStateChange = (event: CustomEvent) => {
            const { isPlaying } = event.detail
            console.log('语音通话中检测到TTS状态变化:', isPlaying)
            this.callbacks?.onSpeakingStateChange(isPlaying)
          }

          // 添加事件监听器
          window.addEventListener('tts-state-change', handleTTSStateChange as EventListener)

          // 更新助手消息的内容
          assistantMessage.content = fullResponse
          assistantMessage.status = 'success'

          // 使用speakFromMessage方法播放，会应用TTS过滤选项
          this.ttsService.speakFromMessage(assistantMessage)

          // 设置超时安全机制，确保事件监听器被移除
          setTimeout(() => {
            window.removeEventListener('tts-state-change', handleTTSStateChange as EventListener)
          }, 30000) // 30秒后移除事件监听器
        }

        // 更新对话历史
        this.conversationHistory.push({ role: 'assistant', content: fullResponse })
      } catch (innerError) {
        console.error('Error generating response:', innerError)
        // 如果出错，使用一个简单的回复
        fullResponse = `抱歉，处理您的请求时出错了。`
        this.callbacks?.onResponse(fullResponse)

        if (!this.isMuted && this.isCallActive) {
          // 手动设置语音状态
          this.callbacks?.onSpeakingStateChange(true)

          // 创建一个简单的助手消息对象
          const errorMessage = {
            id: 'error-message',
            role: 'assistant',
            content: fullResponse,
            status: 'success'
          } as Message

          // 使用speakFromMessage方法播放，会应用TTS过滤选项
          this.ttsService.speakFromMessage(errorMessage)

          // 确保语音结束后状态正确
          setTimeout(() => {
            if (this.ttsService && !this.ttsService.isCurrentlyPlaying()) {
              this.callbacks?.onSpeakingStateChange(false)
            }
          }, 1000) // 1秒后检查TTS状态
        }
      }
    } catch (error) {
      console.error('Error processing voice response:', error)
    } finally {
      this.isProcessingResponse = false

      // 不自动恢复语音识别，等待用户长按按钮
      // 长按说话模式下，我们不需要自动恢复语音识别
    }
  }

  /**
   * 停止录音并将结果发送到聊天界面
   * @returns Promise<boolean> 是否成功停止录音
   */
  async stopRecordingAndSendToChat(): Promise<boolean> {
    if (!this.isCallActive || !this.isRecording) {
      return false
    }

    // 清除录音超时定时器
    if (this.recordingTimeout) {
      clearTimeout(this.recordingTimeout)
      this.recordingTimeout = null
    }

    // 获取当前ASR服务类型
    const { asrServiceType } = store.getState().settings

    try {
      // 立即设置录音状态为false，防止重复处理
      this.isRecording = false
      this.callbacks?.onListeningStateChange(false)

      // 存储当前的语音识别结果，用于松开按钮后发送给AI
      const currentTranscript = this._currentTranscript
      // 存储累积的语音识别结果
      const accumulatedTranscript = this._accumulatedTranscript

      if (asrServiceType === 'browser') {
        // 浏览器ASR
        if (!this.recognition) {
          throw new Error('Browser speech recognition not initialized')
        }

        this.recognition.stop()

        // 优先使用累积的文本，如果有的话
        if (accumulatedTranscript && accumulatedTranscript.trim()) {
          console.log('发送累积的语音识别结果给聊天界面:', accumulatedTranscript)
          this.handleUserSpeech(accumulatedTranscript, true)
        } else if (currentTranscript && currentTranscript.trim()) {
          // 如果没有累积结果，使用当前结果
          console.log('没有累积结果，使用当前结果发送给聊天界面:', currentTranscript)
          this.handleUserSpeech(currentTranscript, true)
        } else {
          console.log('没有有效的语音识别结果，不发送消息')
          window.message.info({ content: '没有收到语音输入', key: 'voice-call-empty' })
        }

        // 清除状态
        this._currentTranscript = ''
        this._accumulatedTranscript = ''
      } else if (asrServiceType === 'local') {
        // 本地服务器ASR
        // 创建一个承诺，等待最终结果
        const finalResultPromise = new Promise<string>((resolve) => {
          // 设置一个超时器，确保不会无限等待
          const timeoutId = setTimeout(() => {
            console.log('等待最终结果超时，使用当前结果')
            resolve(this._currentTranscript)
          }, 1500) // 1.5秒超时

          // 设置回调函数来接收最终结果
          const resultCallback = (text: string, isFinal?: boolean) => {
            // 如果是空字符串，表示只是重置状态，不处理
            if (text === '') return

            if (text) {
              // 只处理最终结果，忽略中间结果
              if (isFinal) {
                clearTimeout(timeoutId)
                console.log('收到最终语音识别结果:', text)
                this._currentTranscript = text
                this.callbacks?.onTranscript(text)
                resolve(text)
              } else {
                // 对于中间结果，只更新显示，不解析Promise
                console.log('收到中间语音识别结果:', text)
                this.callbacks?.onTranscript(text)
              }
            }
          }

          // 停止录音，但不取消，以获取最终结果
          ASRService.stopRecording(resultCallback)

          // 添加额外的安全措施，在停止后立即发送重置命令
          setTimeout(() => {
            // 发送重置命令，确保浏览器不会继续发送结果
            ASRService.cancelRecording()

            // 清除ASRService中的回调函数，防止后续结果被处理
            ASRService.resultCallback = null
          }, 2000) // 2秒后强制取消，作为安全措施
        })

        // 等待最终结果，但最多等待3秒
        const finalText = await finalResultPromise

        // 优先使用累积的文本，如果有的话
        if (accumulatedTranscript && accumulatedTranscript.trim()) {
          console.log('发送累积的语音识别结果给聊天界面:', accumulatedTranscript)
          this.handleUserSpeech(accumulatedTranscript, true)
        } else if (finalText && finalText.trim()) {
          // 如果没有累积结果，使用最终结果
          console.log('发送最终语音识别结果给聊天界面:', finalText)
          this.handleUserSpeech(finalText, true)
        } else if (currentTranscript && currentTranscript.trim()) {
          // 如果没有最终结果，使用当前结果
          console.log('没有最终结果，使用当前结果发送给聊天界面:', currentTranscript)
          this.handleUserSpeech(currentTranscript, true)
        } else {
          console.log('没有有效的语音识别结果，不发送消息')
          window.message.info({ content: '没有收到语音输入', key: 'voice-call-empty' })
        }

        // 再次确保所有状态被重置
        this._currentTranscript = ''
        this._accumulatedTranscript = ''
      } else if (asrServiceType === 'openai') {
        // OpenAI ASR
        await ASRService.stopRecording((text) => {
          // 更新最终的语音识别结果
          if (text) {
            this._currentTranscript = text
            this.callbacks?.onTranscript(text)
          }
        })

        // 使用最新的语音识别结果
        const finalTranscript = this._currentTranscript
        if (finalTranscript && finalTranscript.trim()) {
          console.log('发送OpenAI语音识别结果给聊天界面:', finalTranscript)
          this.handleUserSpeech(finalTranscript, true)
        } else {
          console.log('没有有效的OpenAI语音识别结果，不发送消息')
          window.message.info({ content: '没有收到语音输入', key: 'voice-call-empty' })
        }

        // 清除状态
        this._currentTranscript = ''
        this._accumulatedTranscript = ''
      }

      return true
    } catch (error) {
      console.error('Failed to stop recording:', error)
      this.isRecording = false
      this.callbacks?.onListeningStateChange(false)

      // 确保在出错时也清除状态
      this._currentTranscript = ''
      this._accumulatedTranscript = ''

      // 强制取消录音
      ASRService.cancelRecording()

      return false
    }
  }

  /**
   * 取消录音，不发送给AI
   * @returns Promise<boolean> 是否成功取消录音
   */
  async cancelRecording(): Promise<boolean> {
    if (!this.isCallActive || !this.isRecording) {
      return false
    }

    // 清除录音超时定时器
    if (this.recordingTimeout) {
      clearTimeout(this.recordingTimeout)
      this.recordingTimeout = null
    }

    // 获取当前ASR服务类型
    const { asrServiceType } = store.getState().settings

    try {
      if (asrServiceType === 'browser') {
        // 浏览器ASR
        if (!this.recognition) {
          throw new Error('Browser speech recognition not initialized')
        }

        this.recognition.stop()
        this.isRecording = false
        this.callbacks?.onListeningStateChange(false)
      } else if (asrServiceType === 'local') {
        // 本地服务器ASR
        ASRService.cancelRecording()
        this.isRecording = false
        this.callbacks?.onListeningStateChange(false)
      } else if (asrServiceType === 'openai') {
        // OpenAI ASR
        ASRService.cancelRecording()
        this.isRecording = false
        this.callbacks?.onListeningStateChange(false)
      }

      // 清除当前识别结果
      this._currentTranscript = ''
      this.callbacks?.onTranscript('')

      return true
    } catch (error) {
      console.error('Failed to cancel recording:', error)
      this.isRecording = false
      this.callbacks?.onListeningStateChange(false)
      return false
    }
  }

  setMuted(muted: boolean) {
    this.isMuted = muted

    // 如果设置为静音，停止当前TTS播放
    if (muted && this.ttsService.isCurrentlyPlaying()) {
      this.ttsService.stop()
    }
  }

  /**
   * 停止TTS播放
   * @returns void
   */
  stopTTS(): void {
    // 无论是否正在播放，都强制停止TTS
    this.ttsService.stop()
    console.log('强制停止TTS播放')

    // 注意：不需要手动触发事件，因为在TTSService.stop()中已经触发了
  }

  setPaused(paused: boolean) {
    this.isPaused = paused

    // 获取当前ASR服务类型
    const { asrServiceType } = store.getState().settings

    if (paused) {
      // 暂停语音识别
      if (asrServiceType === 'browser') {
        this.recognition?.stop()
      } else if (asrServiceType === 'local' || asrServiceType === 'openai') {
        ASRService.cancelRecording()
      }

      // 暂停TTS
      if (this.ttsService.isCurrentlyPlaying()) {
        this.ttsService.stop()
      }
    }
    // 不自动恢复语音识别，等待用户长按按钮
  }

  endCall() {
    this.isCallActive = false

    // 获取当前ASR服务类型
    const { asrServiceType } = store.getState().settings

    // 停止语音识别
    if (asrServiceType === 'browser') {
      this.recognition?.stop()
    } else if (asrServiceType === 'local' || asrServiceType === 'openai') {
      ASRService.cancelRecording()
    }

    // 停止TTS
    if (this.ttsService.isCurrentlyPlaying()) {
      this.ttsService.stop()
    }

    this.callbacks = null
  }
}

export const VoiceCallService = new VoiceCallServiceClass()
