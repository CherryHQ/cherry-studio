import { BaseService, type InitPhaseMeasure } from '@main/core/lifecycle'
import { PerfRecorder, type PerfSpanHandle } from '@main/core/perf'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

class SampleService extends BaseService {
  protected async onInit(): Promise<void> {}
  protected async onReady(): Promise<void> {}
}

class FailingService extends BaseService {
  protected async onInit(): Promise<void> {
    throw new Error('boom')
  }
}

type Initable = { _doInit(measure?: InitPhaseMeasure): Promise<void> }

/**
 * The equivalent of the hook LifecycleManager injects, wired to a real recorder so the
 * assertion is on the contract itself: a service's onInit / onReady become children of
 * that service's span.
 */
function spanMeasure(recorder: PerfRecorder, parent: PerfSpanHandle): InitPhaseMeasure {
  return (name) => {
    const span = recorder.start(name, { track: 'bootstrap', parent })
    return () => span.end()
  }
}

function tickingRecorder() {
  let time = 0
  return new PerfRecorder({ enabled: true, now: () => (time += 5) })
}

describe('BaseService init phase measurement', () => {
  beforeEach(() => BaseService.resetInstances())
  afterEach(() => BaseService.resetInstances())

  it('measures onInit and onReady in order', async () => {
    const seen: string[] = []
    const service = new SampleService()

    await (service as unknown as Initable)._doInit((name) => {
      seen.push(`start:${name}`)
      return () => seen.push(`end:${name}`)
    })

    expect(seen).toEqual(['start:onInit', 'end:onInit', 'start:onReady', 'end:onReady'])
  })

  it('needs no hook at all — an un-instrumented _doInit() still runs both phases', async () => {
    const service = new SampleService()
    await expect((service as unknown as Initable)._doInit()).resolves.toBeUndefined()
    expect(service.state).toBe('ready')
  })

  it('produces onInit and onReady as children of the service span', async () => {
    const recorder = tickingRecorder()
    const service = new SampleService()
    const serviceSpan = recorder.start('SampleService', { track: 'bootstrap' })

    await (service as unknown as Initable)._doInit(spanMeasure(recorder, serviceSpan))
    serviceSpan.end()

    const spans = recorder.snapshot()
    expect(spans.find((span) => span.name === 'onInit')?.parentId).toBe(serviceSpan.id)
    expect(spans.find((span) => span.name === 'onReady')?.parentId).toBe(serviceSpan.id)
    expect(spans.find((span) => span.name === 'onInit')?.track).toBe('bootstrap')
  })

  it('closes the onInit span even when the service throws, so a failed boot still shows its cost', async () => {
    const recorder = tickingRecorder()
    const service = new FailingService()
    const serviceSpan = recorder.start('FailingService', { track: 'bootstrap' })

    await expect((service as unknown as Initable)._doInit(spanMeasure(recorder, serviceSpan))).rejects.toThrow('boom')

    const init = recorder.snapshot().find((span) => span.name === 'onInit')
    expect(init).toBeDefined()
    expect(init?.duration).toBeGreaterThan(0)
  })

  it('records nothing when the recorder is disabled', async () => {
    const recorder = new PerfRecorder({ enabled: false })
    const service = new SampleService()
    const serviceSpan = recorder.start('SampleService', { track: 'bootstrap' })

    await (service as unknown as Initable)._doInit(spanMeasure(recorder, serviceSpan))

    expect(recorder.snapshot()).toEqual([])
  })
})
