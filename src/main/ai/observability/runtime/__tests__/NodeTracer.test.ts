import { trace } from '@opentelemetry/api'
import type { ReadableSpan, SpanProcessor } from '@opentelemetry/sdk-trace-base'
import { afterEach, describe, expect, it } from 'vitest'

import { NodeTracer } from '../NodeTracer'

class RecordingSpanProcessor implements SpanProcessor {
  readonly finished: ReadableSpan[] = []

  constructor(private readonly shutdownError?: Error) {}

  onStart(): void {}

  onEnd(span: ReadableSpan): void {
    this.finished.push(span)
  }

  forceFlush(): Promise<void> {
    return Promise.resolve()
  }

  shutdown(): Promise<void> {
    return this.shutdownError ? Promise.reject(this.shutdownError) : Promise.resolve()
  }
}

describe('NodeTracer runtime lifecycle', () => {
  afterEach(async () => {
    await NodeTracer.shutdown()
  })

  it('records again after an off -> on -> off -> on cycle', async () => {
    const initiallyOff = trace.getTracer('runtime-cycle').startSpan('initially-off')
    expect(initiallyOff.isRecording()).toBe(false)
    initiallyOff.end()

    const firstProcessor = new RecordingSpanProcessor()
    NodeTracer.init({ serviceName: 'CherryStudio', defaultTracerName: 'runtime-cycle' }, firstProcessor)

    const first = trace.getTracer('runtime-cycle').startSpan('first-activation')
    expect(first.isRecording()).toBe(true)
    first.end()
    expect(firstProcessor.finished.map((span) => span.name)).toEqual(['first-activation'])

    await NodeTracer.shutdown()

    const disabled = trace.getTracer('runtime-cycle').startSpan('disabled')
    expect(disabled.isRecording()).toBe(false)
    disabled.end()
    expect(firstProcessor.finished.map((span) => span.name)).toEqual(['first-activation'])

    const secondProcessor = new RecordingSpanProcessor()
    NodeTracer.init({ serviceName: 'CherryStudio', defaultTracerName: 'runtime-cycle' }, secondProcessor)

    const second = trace.getTracer('runtime-cycle').startSpan('second-activation')
    expect(second.isRecording()).toBe(true)
    second.end()

    expect(firstProcessor.finished.map((span) => span.name)).toEqual(['first-activation'])
    expect(secondProcessor.finished.map((span) => span.name)).toEqual(['second-activation'])
  })

  it('unregisters globals even when the span processor fails to shut down', async () => {
    NodeTracer.init(
      { serviceName: 'CherryStudio', defaultTracerName: 'failing-shutdown' },
      new RecordingSpanProcessor(new Error('flush failed'))
    )

    await expect(NodeTracer.shutdown()).rejects.toThrow('flush failed')

    const disabled = trace.getTracer('failing-shutdown').startSpan('disabled-after-error')
    expect(disabled.isRecording()).toBe(false)
    disabled.end()

    const replacement = new RecordingSpanProcessor()
    NodeTracer.init({ serviceName: 'CherryStudio', defaultTracerName: 'failing-shutdown' }, replacement)
    const enabledAgain = trace.getTracer('failing-shutdown').startSpan('enabled-again')
    expect(enabledAgain.isRecording()).toBe(true)
    enabledAgain.end()
    expect(replacement.finished.map((span) => span.name)).toEqual(['enabled-again'])
  })
})
