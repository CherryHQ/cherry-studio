import { describe, expect, it } from 'vitest'

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
        check('boom', async () => {
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
