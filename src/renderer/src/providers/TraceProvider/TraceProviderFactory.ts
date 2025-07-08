import { TraceProviderType } from '@renderer/types/trace'

import BaseTraceProvider from './BaseTraceProvider'
import LangfuseProvider from './LangfuseProvider'

export default class TraceProviderFactory {
  static create(provider: TraceProviderType): BaseTraceProvider {
    switch (provider) {
      case 'langfuse':
        return new LangfuseProvider(provider)
      default:
        throw new Error(`Trace provider ${provider} not found`)
    }
  }
}
