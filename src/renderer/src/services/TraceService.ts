import TraceProvider from '@renderer/providers/TraceProvider'
import store from '@renderer/store'
import Logger from 'electron-log/renderer'

export class TraceService {
  /**
   * 检查trace功能是否启用
   */
  static isTraceEnabled(): boolean {
    const state = store.getState()
    return state.trace.enabled
  }

  /**
   * 获取当前配置的trace provider实例
   */
  static getTraceProvider(): TraceProvider | null {
    if (!this.isTraceEnabled()) {
      return null
    }

    const state = store.getState()
    const providerType = state.trace.provider

    try {
      return new TraceProvider(providerType)
    } catch (error) {
      Logger.error('Failed to create trace provider:', error)
      return null
    }
  }
}
