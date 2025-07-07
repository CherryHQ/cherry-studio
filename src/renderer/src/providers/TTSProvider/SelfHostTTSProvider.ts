import type { TTSSpeakOptions, Voice } from '@/types/tts'

import { BaseTTSProvider, TTSCheckResult } from './BaseTTSProvider'

/**
 * SelfHostTTSProvider
 *
 * 实现了对用户自建 TTS 服务的支持。
 * 核心设计是基于“生产者-消费者”模式的流式播放，以实现低延迟的音频体验。
 *
 * @class SelfHostTTSProvider
 * @extends {BaseTTSProvider}
 */
export class SelfHostTTSProvider extends BaseTTSProvider {
  // --- 状态管理属性 ---

  /**
   * @private
   * @type {string[]}
   * @description 句子队列，存储待处理的文本片段。生产者从这里取任务。
   */
  private sentenceQueue: string[] = []

  /**
   * @private
   * @type {(Blob | 'EOS')[]}
   * @description 音频队列，存储已获取的音频 Blob 或流结束标志 ('EOS')。消费者从这里取数据。
   */
  private audioQueue: (Blob | 'EOS')[] = []

  /**
   * @private
   * @type {boolean}
   * @description 核心状态标志，控制整个播放流程的生命周期。当为 false 时，所有循环都应终止。
   */
  private isSpeaking: boolean = false

  /**
   * @private
   * @type {(Promise<void> | null)}
   * @description 指向生产者循环的 Promise，用于在 stop() 中优雅地等待其结束。
   */
  private audioConsumerPromise: Promise<void> | null = null

  /**
   * @private
   * @type {(Promise<void> | null)}
   * @description 指向消费者循环的 Promise，用于在 stop() 中优雅地等待其结束。
   */
  private audioProducerPromise: Promise<void> | null = null

  // --- 接口实现方法 ---

  /**
   * 获取可用的语音列表。
   * 对于自建服务，通常没有一个标准化的方式来获取语音列表，因此返回一个固定的默认值。
   * @returns {Promise<Voice[]>}
   */
  public async getVoices(): Promise<Voice[]> {
    // 对于自建服务，我们目前不支持动态语音列表。
    return Promise.resolve([{ id: 'default', name: 'Default' }])
  }

  /**
   * 将长文本分割成句子。
   * 这是实现流式播放的第一步，确保我们可以一小段一小段地请求音频。
   * @private
   * @param {string} text - 原始输入文本。
   * @returns {string[]} - 分割后的句子数组。
   */
  private splitIntoSentences(text: string): string[] {
    if (!text) return []
    // 使用正则表达式按句子分割，兼容中英文标点和换行符。
    const sentences = text.match(/[^.!?。？！]+[.!?。？！\n]*/g) || [text]
    return sentences.map((s) => s.trim()).filter((s) => s.length > 0)
  }

  /**
   * **执行顺序: 1. 入口方法**
   *
   * 开始播放指定的文本。
   * @param {TTSSpeakOptions} options - 包含文本、音量、错误回调等播放选项。
   */
  public async speak(options: TTSSpeakOptions): Promise<void> {
    // **执行顺序: 1.1** - 确保在开始前，所有旧的播放任务都已完全停止。
    await this.stop()

    const { text, volume, onError } = options
    if (!text.trim()) {
      return // 如果没有文本，则不执行任何操作。
    }

    // **执行顺序: 1.2** - 设置核心状态，启动播放流程。
    this.isSpeaking = true
    this.sentenceQueue = this.splitIntoSentences(text)

    // **执行顺序: 1.3** - 如果有句子需要处理，则同时启动生产者和消费者循环。
    if (this.sentenceQueue.length > 0) {
      this.audioProducerPromise = this.producerLoop(onError)
      this.audioConsumerPromise = this.consumerLoop(volume, onError)
    }
  }

  /**
   * **执行顺序: (可随时调用)**
   *
   * 停止当前的播放任务。
   * 这是一个安全阀，确保可以随时中断播放并清理所有资源。
   */
  public async stop(): Promise<void> {
    if (this.isSpeaking) {
      this.isSpeaking = false
      // **关键**: 等待两个循环都完全终止。
      // `Promise.allSettled` 确保即使一个循环出错，我们也会等待另一个结束。
      await Promise.allSettled([this.audioProducerPromise, this.audioConsumerPromise])
    }
    // 清理队列和状态
    this.sentenceQueue = []
    this.audioQueue = []
    // 调用父类的 stop 方法，实际停止音频播放器。
    await super.stop()
  }

  // --- 核心循环：生产者 & 消费者 ---

  /**
   * **执行顺序: 2. 生产者循环 (后台)**
   *
   * 负责从 `sentenceQueue` 中取出句子，获取音频，然后放入 `audioQueue`。
   * @private
   * @param {((error: Error) => void)} [onError] - 错误回调函数。
   */
  private async producerLoop(onError?: (error: Error) => void): Promise<void> {
    // 只要还在播放状态并且还有句子要处理
    while (this.isSpeaking && this.sentenceQueue.length > 0) {
      // 新增：背压机制检查。如果音频队列过长，则暂停生产。
      if (this.audioQueue.length > 5) {
        await new Promise((resolve) => setTimeout(resolve, 200))
        continue // 暂停后重新检查循环条件
      }

      const sentence = this.sentenceQueue.shift()! // 取出下一个句子
      try {
        // **执行顺序: 2.1** - 获取音频数据
        const audioBlob = await this.fetchAudio(sentence)
        if (this.isSpeaking) {
          // **执行顺序: 2.2** - 将获取到的音频放入队列，供消费者使用
          this.audioQueue.push(audioBlob)
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error('Failed to fetch audio from self-host service')
        console.error(`[SelfHostTTSProvider] Failed to fetch audio for: "${sentence}"`, err)
        // 新增：调用错误回调，将错误信息传递到 UI 层
        onError?.(err)
        this.isSpeaking = false // 如果获取音频失败，则停止整个播放流程。
      }
    }
    // 所有句子都处理完毕后，向队列中放入一个“结束标志”
    if (this.isSpeaking) {
      this.audioQueue.push('EOS') // EOS = End of Stream
    }
  }

  /**
   * **执行顺序: 3. 消费者循环 (后台)**
   *
   * 负责从 `audioQueue` 中取出音频数据并播放。
   * @private
   * @param {number} [volume] - 播放音量。
   * @param {((error: Error) => void)} [onError] - 错误回调函数。
   */
  private async consumerLoop(volume?: number, onError?: (error: Error) => void): Promise<void> {
    // 只要还在播放状态
    while (this.isSpeaking) {
      if (this.audioQueue.length > 0) {
        const nextItem = this.audioQueue.shift()! // 取出下一个音频或标志

        // **执行顺序: 3.1** - 检查是否是结束标志
        if (nextItem === 'EOS') {
          this.isSpeaking = false // 流结束，正常停止
          break
        }

        try {
          // **执行顺序: 3.2** - 播放音频。这个 promise 会在音频播放完毕后 resolve。
          await this.audioPlayer.playBlob(nextItem, volume)
        } catch (error) {
          const err = error instanceof Error ? error : new Error('Failed to play audio blob')
          console.error('[SelfHostTTSProvider] Failed to play audio blob.', err)
          // 新增：调用错误回调
          onError?.(err)
          this.isSpeaking = false // 如果播放失败，则停止整个流程。
        }
      } else {
        // 如果队列是空的，说明生产者还没准备好新的音频，短暂等待一下。
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    }
  }

  // --- 网络与数据处理 ---

  /**
   * **执行顺序: (由生产者调用)**
   *
   * 向用户配置的自建服务 URL 发送请求，获取音频数据。
   * @private
   * @param {string} text - 要转换为语音的文本。
   * @returns {Promise<Blob>} - 返回音频的 Blob 数据。
   */
  private async fetchAudio(text: string): Promise<Blob> {
    const config = this.provider.self_host

    if (!config?.url) {
      throw new Error('Self-host TTS configuration is incomplete. URL is missing.')
    }

    // 用户可以在设置中定义请求的 body，这里提供一个默认值。
    const bodyString =
      config.body && config.body.trim() !== '' ? config.body : JSON.stringify({ model: 'tts-1', input: '{{input}}' })

    let bodyObject
    try {
      // 步骤 1: 将配置中的 body 字符串解析为真正的 JS 对象。
      bodyObject = JSON.parse(bodyString)
    } catch (e) {
      throw new Error('Self-host TTS body in configuration is not valid JSON.')
    }

    // 步骤 2: 在解析后的对象中，递归查找并替换占位符 `{{input}}`。
    const placeholderFound = this.findAndReplacePlaceholder(bodyObject, '{{input}}', text)
    if (!placeholderFound) {
      throw new Error("Could not find '{{input}}' placeholder in the TTS body configuration.")
    }

    // 步骤 3: 将最终的对象序列化为 JSON 字符串，用于 fetch 请求。
    const finalBody = JSON.stringify(bodyObject)

    const response = await fetch(config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: finalBody
    })

    if (!response.ok) {
      throw new Error(`Server returned status ${response.status}`)
    }

    return response.blob()
  }

  /**
   * 递归地在对象或数组中查找并替换占位符字符串。
   * 这使得用户可以定义非常灵活的、深层嵌套的 JSON body 结构。
   * @private
   * @param {any} obj - 要进行操作的对象或数组。
   * @param {string} placeholder - 要查找的占位符，例如 '{{input}}'。
   * @param {string} replacement - 替换后的真实文本。
   * @returns {boolean} - 是否找到了并替换了占位符。
   */
  private findAndReplacePlaceholder(obj: any, placeholder: string, replacement: string): boolean {
    let found = false
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        if (typeof obj[key] === 'object' && obj[key] !== null) {
          // 递归进入子对象或数组
          if (this.findAndReplacePlaceholder(obj[key], placeholder, replacement)) {
            found = true
          }
        } else if (typeof obj[key] === 'string' && obj[key].includes(placeholder)) {
          // 找到字符串并替换。使用 replaceAll 以防一个字段里有多个占位符。
          obj[key] = obj[key].replaceAll(placeholder, replacement)
          found = true
        }
      }
    }
    return found
  }

  /**
   * **执行顺序: (在设置页面调用)**
   *
   * 检查自建服务的配置是否有效（例如 URL 是否可达）。
   * @returns {Promise<TTSCheckResult>}
   */
  public async check(): Promise<TTSCheckResult> {
    const config = this.provider.self_host
    if (!config?.url) {
      return { valid: false, error: new Error('URL is not configured.') }
    }
    try {
      // 使用 HEAD 请求进行轻量级检查，避免传输不必要的数据。
      const response = await fetch(config.url, { method: 'HEAD' })
      return {
        valid: response.ok,
        error: response.ok ? null : new Error(`Server returned status ${response.status}`)
      }
    } catch (error) {
      return { valid: false, error: error as Error }
    }
  }

  /**
   * 返回默认的 API 主机地址（此处不需要）。
   * @protected
   * @returns {string}
   */
  protected getDefaultApiHost(): string {
    return ''
  }
}
