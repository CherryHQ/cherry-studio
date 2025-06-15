import Logger from '@renderer/config/logger'
import { Message } from '@renderer/types'
import { BaseObservationSpec, BaseTraceSpec, TraceProviderType } from '@renderer/types/trace'

import BaseTraceProvider from './BaseTraceProvider'
import TraceProviderFactory from './TraceProviderFactory'

export default class TraceProvider {
  private sdk: BaseTraceProvider

  constructor(provider: TraceProviderType) {
    this.sdk = TraceProviderFactory.create(provider)
  }

  public async createTrace(contextMessages?: Message[], spec?: BaseTraceSpec): Promise<void> {
    await this.sdk.createTrace(contextMessages, spec).catch((error) => {
      Logger.warn('Failed to create trace:', error)
    })
  }

  public async startObservation(contextMessages: Message[], spec?: BaseObservationSpec): Promise<void> {
    await this.sdk.startObservation(contextMessages, spec).catch((error) => {
      Logger.warn('Failed to start observation:', error)
    })
  }

  public async stopObservation(messageId: string): Promise<void> {
    await this.sdk.stopObservation(messageId).catch((error) => {
      Logger.warn('Failed to stop observation:', error)
    })
  }

  public async close(): Promise<void> {
    await this.sdk.close().catch((error) => {
      Logger.warn('Failed to close trace provider:', error)
    })
  }
}
