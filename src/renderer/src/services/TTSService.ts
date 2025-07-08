import { INITIAL_TTS_PROVIDERS } from '@renderer/config/tts'
import { BaseTTSProvider, TTSProviderFactory } from '@renderer/providers/TTSProvider'
import { TTSProvider, TTSSpeakOptions } from '@renderer/types/tts'

export class TTSService {
  private static instance: TTSService
  private providers: Map<string, BaseTTSProvider> = new Map()
  private currentProvider: BaseTTSProvider | null = null
  private ttsProviders: TTSProvider[] = INITIAL_TTS_PROVIDERS
  private activeProvider: BaseTTSProvider | null = null // 当前正在播放的供应商

  private constructor() {
    this.initializeProviders()
  }

  static getInstance(): TTSService {
    if (!TTSService.instance) {
      TTSService.instance = new TTSService()
    }
    return TTSService.instance
  }

  /**
   * 初始化所有供应商
   */
  private initializeProviders(): void {
    this.ttsProviders.forEach((provider) => {
      const providerInstance = TTSProviderFactory.create(provider)
      this.providers.set(provider.id, providerInstance)
    })

    // 设置默认供应商（第一个启用的供应商）
    const enabledProvider = this.ttsProviders.find((p) => p.enabled)
    if (enabledProvider) {
      this.currentProvider = this.providers.get(enabledProvider.id) || null
    }
  }

  /**
   * 设置当前供应商
   */
  setCurrentProvider(providerId: string): boolean {
    if (!providerId) {
      // 如果 providerId 为空，清除当前供应商
      this.currentProvider = null
      return true
    }

    const provider = this.providers.get(providerId)
    if (provider) {
      this.currentProvider = provider
      return true
    }
    return false
  }

  /**
   * 获取当前供应商
   */
  getCurrentProvider(): BaseTTSProvider | null {
    return this.currentProvider
  }

  /**
   * 获取所有供应商
   */
  getAllProviders(): TTSProvider[] {
    return this.ttsProviders
  }

  /**
   * 更新供应商配置
   */
  updateProvider(updatedProvider: TTSProvider): void {
    // 更新配置
    const index = this.ttsProviders.findIndex((p) => p.id === updatedProvider.id)
    if (index !== -1) {
      this.ttsProviders[index] = updatedProvider
    }

    // 更新供应商实例
    const providerInstance = this.providers.get(updatedProvider.id)
    if (providerInstance) {
      providerInstance.updateProvider(updatedProvider)
    }

    // 如果是当前供应商，更新当前实例
    if (this.currentProvider?.getProvider().id === updatedProvider.id) {
      this.currentProvider = providerInstance || null
    }
  }

  /**
   * 语音合成
   */
  async speak(text: string, options?: Partial<TTSSpeakOptions>, providerOverride?: TTSProvider): Promise<void> {
    // 如果传入了覆盖配置，则使用它；否则，使用内部的 currentProvider
    const providerToUse = providerOverride ? TTSProviderFactory.create(providerOverride) : this.currentProvider

    if (!providerToUse) {
      throw new Error('No TTS provider available')
    }

    const providerConfig = providerToUse.getProvider()
    if (!providerConfig || !providerConfig.enabled) {
      throw new Error('Current TTS provider is not configured or disabled')
    }

    // 停止所有正在播放的 TTS
    this.stopAll()

    // 等待一小段时间确保停止操作完成
    await new Promise((resolve) => setTimeout(resolve, 50))

    const speakOptions: TTSSpeakOptions = {
      text,
      voice: options?.voice || providerConfig.settings.voice,
      rate: options?.rate || providerConfig.settings.rate,
      pitch: options?.pitch || providerConfig.settings.pitch,
      volume: options?.volume || providerConfig.settings.volume
    }

    // 设置当前活跃供应商
    this.activeProvider = providerToUse

    try {
      await providerToUse.speak(speakOptions)
      // 播放完成后清除活跃供应商
      if (this.activeProvider === providerToUse) {
        this.activeProvider = null
      }
    } catch (error) {
      // 播放失败后清除活跃供应商
      if (this.activeProvider === providerToUse) {
        this.activeProvider = null
      }
      throw error
    }
  }

  /**
   * 暂停播放
   */
  pause(): void {
    this.activeProvider?.pause()
  }

  /**
   * 恢复播放
   */
  resume(): void {
    this.activeProvider?.resume()
  }

  /**
   * 停止播放
   */
  stop(): void {
    this.activeProvider?.stop()
  }

  /**
   * 停止所有正在播放的 TTS
   */
  stopAll(): void {
    try {
      // 停止当前活跃的供应商
      if (this.activeProvider) {
        this.activeProvider.stop()
        this.activeProvider = null
      }
      // 也停止当前供应商（以防万一）
      if (this.currentProvider) {
        this.currentProvider.stop()
      }
      // 停止所有供应商实例（确保彻底清理）
      this.providers.forEach((provider) => {
        try {
          provider.stop()
        } catch (error) {
          // 忽略单个供应商停止时的错误
        }
      })
    } catch (error) {
      // 忽略 stopAll 中的错误
    }
  }

  /**
   * 检查是否正在播放
   */
  isPlaying(): boolean {
    return this.currentProvider?.isPlaying() || false
  }

  /**
   * 检查是否已暂停
   */
  isPaused(): boolean {
    return this.currentProvider?.isPaused() || false
  }

  /**
   * 获取指定供应商的语音列表
   */
  async getVoices(providerId?: string): Promise<any[]> {
    const provider = providerId ? this.providers.get(providerId) : this.currentProvider

    if (!provider) {
      return []
    }

    return provider.getVoices()
  }

  /**
   * 更新供应商语音列表
   */
  updateProviderVoices(providerId: string, voices: any[]): void {
    // 更新配置中的语音列表
    const providerConfig = this.ttsProviders.find((p) => p.id === providerId)
    if (providerConfig) {
      providerConfig.voices = voices
    }

    // 更新供应商实例中的配置
    const providerInstance = this.providers.get(providerId)
    if (providerInstance && providerConfig) {
      providerInstance.updateProvider(providerConfig)
    }
  }

  /**
   * 设置供应商启用状态
   */
  setProviderEnabled(providerId: string, enabled: boolean): void {
    const providerConfig = this.ttsProviders.find((p) => p.id === providerId)
    if (providerConfig) {
      providerConfig.enabled = enabled

      // 更新供应商实例
      const providerInstance = this.providers.get(providerId)
      if (providerInstance) {
        providerInstance.updateProvider(providerConfig)
      }
    }
  }

  /**
   * 设置供应商 API Key
   */
  setProviderApiKey(providerId: string, apiKey: string): void {
    const providerConfig = this.ttsProviders.find((p) => p.id === providerId)
    if (providerConfig) {
      providerConfig.apiKey = apiKey

      // 更新供应商实例
      const providerInstance = this.providers.get(providerId)
      if (providerInstance) {
        providerInstance.updateProvider(providerConfig)
      }
    }
  }

  /**
   * 更新供应商设置
   */
  updateProviderSettings(providerId: string, settings: Partial<any>): void {
    const providerConfig = this.ttsProviders.find((p) => p.id === providerId)
    if (providerConfig) {
      providerConfig.settings = { ...providerConfig.settings, ...settings }

      // 更新供应商实例
      const providerInstance = this.providers.get(providerId)
      if (providerInstance) {
        providerInstance.updateProvider(providerConfig)
      }
    }
  }

  /**
   * 检查供应商配置
   */
  async checkProvider(providerId: string): Promise<{ valid: boolean; error: Error | null }> {
    const provider = this.providers.get(providerId)
    if (!provider) {
      return {
        valid: false,
        error: new Error('Provider not found')
      }
    }

    return provider.check()
  }

  /**
   * 获取启用的供应商
   */
  getEnabledProviders(): TTSProvider[] {
    return this.ttsProviders.filter((p) => p.enabled)
  }

  /**
   * 检查是否有可用的 TTS 供应商
   */
  hasAvailableProvider(): boolean {
    return this.getEnabledProviders().length > 0
  }

  /**
   * 自动选择最佳供应商
   */
  async selectBestProvider(): Promise<boolean> {
    const enabledProviders = this.getEnabledProviders()

    for (const provider of enabledProviders) {
      const result = await this.checkProvider(provider.id)
      if (result.valid) {
        this.setCurrentProvider(provider.id)
        return true
      }
    }

    return false
  }

  /**
   * 重新加载供应商配置
   */
  reloadProviders(providers: TTSProvider[]): void {
    this.ttsProviders = providers
    this.providers.clear()
    this.currentProvider = null
    this.initializeProviders()
  }
}
