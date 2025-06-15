import { Message } from '@renderer/types'
import { BaseObservationSpec, BaseTraceSpec, TraceProviderType } from '@renderer/types/trace'

export default abstract class BaseTraceProvider {
  protected provider: TraceProviderType

  constructor(provider: TraceProviderType) {
    this.provider = provider
  }

  abstract createTrace(contextMessages?: Message[], spec?: BaseTraceSpec): Promise<void>
  abstract startObservation(contextMessages: Message[], spec?: BaseObservationSpec): Promise<void>
  abstract stopObservation(messageId: string): Promise<void>
  abstract close(): Promise<void>
}
