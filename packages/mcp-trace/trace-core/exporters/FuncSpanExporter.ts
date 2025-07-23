import { ExportResult, ExportResultCode } from '@opentelemetry/core'
import { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base'

export type SaveFunction = (spans: ReadableSpan[]) => Promise<void>

export class FunctionSpanExporter implements SpanExporter {
  private exportFunction: SaveFunction

  constructor(fn: SaveFunction) {
    this.exportFunction = fn
  }

  shutdown(): Promise<void> {
    return Promise.resolve()
  }

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    this.exportFunction(spans)
      .then(() => {
        resultCallback({ code: ExportResultCode.SUCCESS })
      })
      .catch((error) => {
        resultCallback({ code: ExportResultCode.FAILED, error: error })
      })
  }
}
