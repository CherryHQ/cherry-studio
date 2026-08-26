import type { ReadableSpan, SpanProcessor } from '@opentelemetry/sdk-trace-base'
import { afterEach, describe, expect, it } from 'vitest'

import { NodeTracer } from '../../runtime/NodeTracer'
import { TraceMethod } from '../traceMethod'

class RecordingSpanProcessor implements SpanProcessor {
  readonly finished: ReadableSpan[] = []

  onStart(): void {}

  onEnd(span: ReadableSpan): void {
    this.finished.push(span)
  }

  forceFlush(): Promise<void> {
    return Promise.resolve()
  }

  shutdown(): Promise<void> {
    return Promise.resolve()
  }
}

class DecoratedFixture {
  async run(value: string): Promise<string> {
    return value
  }
}

const descriptor = Object.getOwnPropertyDescriptor(DecoratedFixture.prototype, 'run')!
TraceMethod({ traceName: 'decorator-cycle', spanName: 'decorated-run' })(DecoratedFixture.prototype, 'run', descriptor)
Object.defineProperty(DecoratedFixture.prototype, 'run', descriptor)

describe('TraceMethod runtime lifecycle', () => {
  afterEach(async () => {
    await NodeTracer.shutdown()
  })

  it('uses the newly registered provider after tracing is re-enabled', async () => {
    const fixture = new DecoratedFixture()
    const firstProcessor = new RecordingSpanProcessor()
    NodeTracer.init({ serviceName: 'CherryStudio', defaultTracerName: 'decorator-cycle' }, firstProcessor)

    await expect(fixture.run('first')).resolves.toBe('first')
    expect(firstProcessor.finished.map((span) => span.name)).toEqual(['decorated-run'])

    await NodeTracer.shutdown()

    const secondProcessor = new RecordingSpanProcessor()
    NodeTracer.init({ serviceName: 'CherryStudio', defaultTracerName: 'decorator-cycle' }, secondProcessor)

    await expect(fixture.run('second')).resolves.toBe('second')
    expect(firstProcessor.finished.map((span) => span.name)).toEqual(['decorated-run'])
    expect(secondProcessor.finished.map((span) => span.name)).toEqual(['decorated-run'])
  })
})
