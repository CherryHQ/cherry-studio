import { TTSProvider, TTSSpeakOptions, TTSVoice } from '@renderer/types/tts'

import { AudioPlayerManager } from './AudioPlayerManager'

export interface TTSCheckResult {
  valid: boolean
  error: Error | null
}

export abstract class BaseTTSProvider {
  protected provider: TTSProvider
  protected audioPlayer: AudioPlayerManager

  constructor(provider: TTSProvider) {
    this.provider = provider
    this.audioPlayer = new AudioPlayerManager()
  }

  /**
   * 获取可用语音列表
   */
  abstract getVoices(): Promise<TTSVoice[]>

  /**
   * 开始语音合成
   */
  abstract speak(options: TTSSpeakOptions): Promise<void>

  /**
   * 暂停语音播放
   */
  pause(): void {
    this.audioPlayer.pause()
  }

  /**
   * 恢复语音播放
   */
  resume(): void {
    this.audioPlayer.resume()
  }

  /**
   * 停止语音播放
   */
  stop(): void {
    this.audioPlayer.stop()
  }

  /**
   * 检查供应商配置是否有效
   */
  abstract check(): Promise<TTSCheckResult>

  /**
   * 获取当前播放状态
   */
  isPlaying(): boolean {
    return this.audioPlayer.isPlaying()
  }

  /**
   * 获取当前暂停状态
   */
  isPaused(): boolean {
    return this.audioPlayer.isPaused()
  }

  /**
   * 获取供应商信息
   */
  getProvider(): TTSProvider {
    return this.provider
  }

  /**
   * 更新供应商配置
   */
  updateProvider(provider: TTSProvider): void {
    this.provider = provider
  }

  /**
   * 检查是否支持某个功能
   */
  protected supportsFeature(feature: string): boolean {
    // 这里可以根据供应商类型返回支持的功能
    // 默认支持所有功能，子类可以重写此方法
    console.debug(`Checking feature support: ${feature}`)
    return true
  }

  /**
   * 验证 API Key（如果需要）
   */
  protected validateApiKey(): boolean {
    if (this.requiresApiKey()) {
      return !!this.provider.apiKey && this.provider.apiKey.trim().length > 0
    }
    return true
  }

  /**
   * 检查是否需要 API Key
   */
  protected requiresApiKey(): boolean {
    return this.provider.type !== 'web-speech'
  }

  /**
   * 获取 API 主机地址
   */
  protected getApiHost(): string {
    return this.provider.apiHost || this.getDefaultApiHost()
  }

  /**
   * 获取默认 API 主机地址
   */
  protected abstract getDefaultApiHost(): string

  /**
   * 处理错误
   */
  protected handleError(error: any): Error {
    if (error instanceof Error) {
      return error
    }
    return new Error(String(error))
  }
}
