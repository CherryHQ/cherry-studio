/**
 * 音频流处理器
 * 用于处理流式TTS的音频数据
 */
export class AudioStreamProcessor {
  private audioContext: AudioContext | null = null
  private audioQueue: Uint8Array[] = []
  private isProcessing: boolean = false

  // 回调函数
  public onAudioBuffer: ((buffer: AudioBuffer) => void) | null = null

  /**
   * 初始化音频处理器
   */
  public async initialize(): Promise<void> {
    // 创建音频上下文
    this.audioContext = new AudioContext()
    this.audioQueue = []
    this.isProcessing = false
  }

  /**
   * 处理音频数据块
   * @param chunk 音频数据块
   */
  public async processAudioChunk(chunk: Uint8Array): Promise<void> {
    if (!this.audioContext) {
      throw new Error('AudioStreamProcessor not initialized')
    }

    // 将数据块添加到队列
    this.audioQueue.push(chunk)

    // 如果没有正在处理，开始处理
    if (!this.isProcessing) {
      this.processQueue()
    }
  }

  /**
   * 处理队列中的音频数据
   */
  private async processQueue(): Promise<void> {
    if (!this.audioContext || this.audioQueue.length === 0) {
      this.isProcessing = false
      return
    }

    this.isProcessing = true

    // 获取队列中的第一个数据块
    const chunk = this.audioQueue.shift()!

    try {
      // 解码音频数据
      // 将SharedArrayBuffer转换为ArrayBuffer
      const arrayBuffer = chunk.buffer instanceof SharedArrayBuffer ? new Uint8Array(chunk.buffer).buffer : chunk.buffer
      const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer as ArrayBuffer)

      // 调用回调函数
      if (this.onAudioBuffer) {
        this.onAudioBuffer(audioBuffer)
      }
    } catch (error) {
      console.error('解码音频数据失败:', error)
    }

    // 继续处理队列中的下一个数据块
    this.processQueue()
  }

  /**
   * 完成处理
   */
  public async finish(): Promise<void> {
    // 等待队列处理完成
    while (this.audioQueue.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    // 关闭音频上下文
    if (this.audioContext) {
      await this.audioContext.close()
      this.audioContext = null
    }
  }
}
