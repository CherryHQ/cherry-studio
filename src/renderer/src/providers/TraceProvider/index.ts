import Logger from '@renderer/config/logger'
import {
  MessageTraceStartSpec,
  MessageTraceStopSpec,
  ObservationStartSpec,
  ObservationStopSpec,
  TraceProviderType
} from '@renderer/types/trace'

import BaseTraceProvider from './BaseTraceProvider'
import TraceProviderFactory from './TraceProviderFactory'

export default class TraceProvider {
  private sdk: BaseTraceProvider

  constructor(provider: TraceProviderType) {
    this.sdk = TraceProviderFactory.create(provider)
  }

  /**
   * 开始消息追踪
   * @param id 消息id
   * @param contextMessages 上下文消息
   * @param spec 追踪配置
   */
  public async startTrace(spec: MessageTraceStartSpec): Promise<void> {
    this.sdk.startTrace(spec).catch((error) => {
      Logger.warn('Failed to create trace:', error)
    })
  }

  public async stopTrace(spec: MessageTraceStopSpec): Promise<void> {
    this.sdk.stopTrace(spec).catch((error) => {
      Logger.warn('Failed to stop trace:', error)
    })
  }

  public async startObservation(spec: ObservationStartSpec): Promise<void> {
    this.sdk.startObservation(spec).catch((error) => {
      Logger.warn('Failed to start observation:', error)
    })
  }

  public async stopObservation(spec: ObservationStopSpec): Promise<void> {
    this.sdk.stopObservation(spec).catch((error) => {
      Logger.warn('Failed to stop observation:', error)
    })
  }

  public async close(): Promise<void> {
    this.sdk.close().catch((error) => {
      Logger.warn('Failed to close trace provider:', error)
    })
  }
}
