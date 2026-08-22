import type { DataResponse, HttpMethod } from '@shared/data/api/types'

interface DataApiInstrumentation {
  recordStart(input: {
    requestId: string
    method: HttpMethod
    path: string
    query?: unknown
    body?: unknown
    retryAttempt: number
  }): void
  recordSuccess(input: { requestId: string; method: HttpMethod; path: string; response: DataResponse }): void
  recordError(input: {
    requestId: string
    method: HttpMethod
    path: string
    error: unknown
    status?: number
    metadata?: DataResponse['metadata']
  }): void
  recordRetry(input: {
    requestId: string
    method: HttpMethod
    path: string
    retryAttempt: number
    error: unknown
  }): void
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

  recordStart(input: Parameters<DataApiInstrumentation['recordStart']>[0]): void {
    this.instrumentation.recordStart(input)
  }

  recordSuccess(input: Parameters<DataApiInstrumentation['recordSuccess']>[0]): void {
    this.instrumentation.recordSuccess(input)
  }

  recordError(input: Parameters<DataApiInstrumentation['recordError']>[0]): void {
    this.instrumentation.recordError(input)
  }

  recordRetry(input: Parameters<DataApiInstrumentation['recordRetry']>[0]): void {
    this.instrumentation.recordRetry(input)
  }
}

export const dataApiInstrumentationService = new DataApiInstrumentationService()
