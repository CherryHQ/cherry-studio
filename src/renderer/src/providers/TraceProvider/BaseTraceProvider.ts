import {
  MessageTraceStartSpec,
  MessageTraceStopSpec,
  ObservationStartSpec,
  ObservationStopSpec,
  TraceProviderType
} from '@renderer/types/trace'

export default abstract class BaseTraceProvider {
  protected provider: TraceProviderType

  constructor(provider: TraceProviderType) {
    this.provider = provider
  }

  abstract startTrace(spec: MessageTraceStartSpec): Promise<void>
  abstract stopTrace(spec: MessageTraceStopSpec): Promise<void>
  abstract startObservation(spec: ObservationStartSpec): Promise<void>
  abstract stopObservation(spec: ObservationStopSpec): Promise<void>
  abstract close(): Promise<void>
}
