import { getActiveResourcesInfo } from 'node:process'

import { describe, expect, it, vi } from 'vitest'

import { CANCELED_MESSAGE, DoctorEngineError, type EngineCheck, runDoctorChecks } from '../engine'

type Outcome = { status: 'pass' | 'fail' }

function check(
  id: string,
  run: EngineCheck<string, Outcome>['run'],
  extra: Partial<Pick<EngineCheck<string, Outcome>, 'requires' | 'timeoutMs' | 'lane'>> = {}
): EngineCheck<string, Outcome> {
  return { id, requires: [], timeoutMs: 1000, lane: 'quick', run, ...extra }
}

const pass = async (): Promise<Outcome> => ({ status: 'pass' })
const fail = async (): Promise<Outcome> => ({ status: 'fail' })
const hang = (signal: AbortSignal) =>
  new Promise<Outcome>((_, reject) => signal.addEventListener('abort', () => reject(new Error('probe noise'))))

describe('runDoctorChecks', () => {
  it('releases the deadline timer when a probe completes early', async () => {
    const pendingTimers = () => getActiveResourcesInfo().filter((resource) => resource === 'Timeout').length
    const before = pendingTimers()
    await runDoctorChecks({ checks: [check('quick', pass, { timeoutMs: 10000 })] })
    expect(pendingTimers()).toBeLessThanOrEqual(before)
  })

  it('defers dependency chains and resumes without repeating completed or previously confirmed work', async () => {
    const effects: string[] = []
    const operation = (id: string) => async (): Promise<Outcome> => {
      effects.push(id)
      return { status: 'pass' }
    }
    const checks = [
      check('automatic', operation('automatic')),
      check('paid', operation('paid')),
      check('dependent', operation('dependent'), { requires: ['paid'] }),
      check('another-paid', operation('another-paid'), { requires: ['dependent'] })
    ]
    const first = await runDoctorChecks({
      checks,
      admit: async (id) => ({ status: id.endsWith('paid') ? 'defer' : 'run' })
    })
    expect(effects).toEqual(['automatic'])
    expect(first.map((entry) => entry.id)).toEqual(['automatic'])
    const second = await runDoctorChecks({
      checks,
      initialResults: first,
      admit: async (id) => ({ status: id === 'another-paid' ? 'defer' : 'run' })
    })
    expect(effects).toEqual(['automatic', 'paid', 'dependent'])
    const third = await runDoctorChecks({ checks, initialResults: second })
    expect(effects).toEqual(['automatic', 'paid', 'dependent', 'another-paid'])
    expect(third).toHaveLength(4)
  })

  it('does not execute when cancellation arrives during admission', async () => {
    const controller = new AbortController()
    let charged = false
    const results = await runDoctorChecks({
      signal: controller.signal,
      checks: [
        check('paid', async () => {
          charged = true
          return { status: 'pass' }
        })
      ],
      admit: async () => {
        controller.abort()
        return { status: 'run' }
      }
    })
    expect(charged).toBe(false)
    expect(results).toMatchObject([{ id: 'paid', status: 'error', message: CANCELED_MESSAGE }])
  })

  it('records a timed-out check as error (not the probe noise) without blocking the others', async () => {
    const results = await runDoctorChecks({ checks: [check('a', hang, { timeoutMs: 20 }), check('b', pass)] })
    expect(results).toMatchObject([
      { id: 'a', status: 'error', message: 'Timed out after 20ms' },
      { id: 'b', status: 'pass' }
    ])
  })

  it('cancels a run: running probes are aborted and unstarted ones settle as canceled', async () => {
    const controller = new AbortController()
    const run = runDoctorChecks({
      checks: [check('running', hang), check('later', pass, { requires: ['running'] })],
      signal: controller.signal
    })
    controller.abort()
    await expect(run).resolves.toMatchObject([
      { id: 'running', status: 'error', message: CANCELED_MESSAGE },
      { id: 'later', status: 'skip', skippedBy: 'running' }
    ])
  })

  it('does not start a queued probe after cancellation', async () => {
    const controller = new AbortController()
    let queuedStarted = false
    const run = runDoctorChecks({
      checks: [
        check('running', hang),
        check('queued', async () => {
          queuedStarted = true
          return { status: 'pass' }
        })
      ],
      laneLimits: { quick: 1 },
      signal: controller.signal
    })

    controller.abort()
    const results = await run
    expect(queuedStarted).toBe(false)
    expect(results).toMatchObject([
      { id: 'running', status: 'error', message: CANCELED_MESSAGE },
      { id: 'queued', status: 'error', message: CANCELED_MESSAGE }
    ])
  })

  it('skips a check whose prerequisite failed and names the blocker', async () => {
    const results = await runDoctorChecks({
      checks: [
        check('dns', fail),
        check('tls', pass, { requires: ['dns'] }),
        check('http', pass, { requires: ['tls'] })
      ]
    })
    expect(results).toMatchObject([
      { id: 'dns', status: 'fail' },
      { id: 'tls', status: 'skip', skippedBy: 'dns' },
      { id: 'http', status: 'skip', skippedBy: 'tls' }
    ])
  })

  it('turns a thrown probe into an error result carrying the message', async () => {
    const results = await runDoctorChecks({
      checks: [
        check('boom', () => {
          throw new Error('probe exploded')
        })
      ]
    })
    expect(results[0]).toMatchObject({ status: 'error', message: 'probe exploded' })
  })

  it('rejects unknown prerequisites and cycles up front', async () => {
    await expect(runDoctorChecks({ checks: [check('a', pass, { requires: ['ghost'] })] })).rejects.toBeInstanceOf(
      DoctorEngineError
    )
    await expect(
      runDoctorChecks({ checks: [check('a', pass, { requires: ['b'] }), check('b', pass, { requires: ['a'] })] })
    ).rejects.toBeInstanceOf(DoctorEngineError)
  })

  it('caps concurrency per lane and leaves other lanes unbounded', async () => {
    let active = 0
    let peak = 0
    const probe = async (): Promise<Outcome> => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      return { status: 'pass' }
    }
    await runDoctorChecks({
      checks: ['l1', 'l2', 'l3', 'l4', 'l5'].map((id) => check(id, probe, { lane: 'live' })),
      laneLimits: { live: 2 }
    })
    expect(peak).toBe(2)
  })

  it('reports a queued probe as active only when its lane starts it', async () => {
    let releaseFirst!: () => void
    const started: string[] = []
    const run = runDoctorChecks({
      checks: [
        check(
          'first',
          () =>
            new Promise((resolve) => {
              releaseFirst = () => resolve({ status: 'pass' })
            }),
          { lane: 'live' }
        ),
        check('second', pass, { lane: 'live' })
      ],
      laneLimits: { live: 1 },
      onStart: (id) => started.push(id)
    })

    await vi.waitFor(() => expect(started).toEqual(['first']))
    releaseFirst()
    await expect(run).resolves.toHaveLength(2)
    expect(started).toEqual(['first', 'second'])
  })

  it('streams each result as it settles and returns them in catalog order', async () => {
    const seen: string[] = []
    const results = await runDoctorChecks({
      checks: [
        check('slow', () => new Promise((resolve) => setTimeout(() => resolve({ status: 'pass' }), 10))),
        check('fast', pass)
      ],
      onResult: (result) => seen.push(result.id)
    })
    expect(seen).toEqual(['fast', 'slow'])
    expect(results.map((r) => r.id)).toEqual(['slow', 'fast'])
  })
})
