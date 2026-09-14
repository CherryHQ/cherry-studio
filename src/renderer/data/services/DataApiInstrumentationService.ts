import type { DataResponse, HttpMethod } from '@shared/data/api/types'

export interface DataApiInstrumentationIdentity {
  requestId: string
  method: HttpMethod
  path: string
}

export type DataApiInstrumentationStart = DataApiInstrumentationIdentity & {
  query?: unknown
  body?: unknown
  retryAttempt: number
}

export type DataApiInstrumentationSuccess = DataApiInstrumentationIdentity & { response: DataResponse }

export type DataApiInstrumentationError = DataApiInstrumentationIdentity & {
  error: unknown
  status?: number
  metadata?: DataResponse['metadata']
}

export type DataApiInstrumentationRetry = DataApiInstrumentationIdentity & {
  retryAttempt: number
  error: unknown
}

interface DataApiInstrumentation {
  recordStart(input: DataApiInstrumentationStart): void
  recordSuccess(input: DataApiInstrumentationSuccess): void
  recordError(input: DataApiInstrumentationError): void
  recordRetry(input: DataApiInstrumentationRetry): void
}

const noOpInstrumentation: DataApiInstrumentation = {
  recordStart: () => {},
  recordSuccess: () => {},
  recordError: () => {},
  recordRetry: () => {}
}

/**
 * Production-safe boundary for optional DataApi instrumentation.
 * The development recorder installs itself during window preparation.
 */
export class DataApiInstrumentationService implements DataApiInstrumentation {
  private instrumentation = noOpInstrumentation

  install(instrumentation: DataApiInstrumentation): void {
    this.instrumentation = instrumentation
  }

  reset(): void {
    this.instrumentation = noOpInstrumentation
  }

  recordStart(input: DataApiInstrumentationStart): void {
    this.instrumentation.recordStart(input)
  }

  recordSuccess(input: DataApiInstrumentationSuccess): void {
    this.instrumentation.recordSuccess(input)
  }

  recordError(input: DataApiInstrumentationError): void {
    this.instrumentation.recordError(input)
  }

  recordRetry(input: DataApiInstrumentationRetry): void {
    this.instrumentation.recordRetry(input)
  }
}

export const dataApiInstrumentationService = new DataApiInstrumentationService()
