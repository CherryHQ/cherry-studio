import { describe, expect, it } from 'vitest'

import { SingleFlight } from '..'

describe('SingleFlight', () => {
  it('starts eagerly and publishes one result before synchronous reentry', async () => {
    const flight = new SingleFlight<string>()
    const gate = Promise.withResolvers<string>()
    const starts: string[] = []
    let reentrant: Promise<string> | undefined
    const first = flight.run(() => {
      starts.push('first')
      expect(flight.isRunning).toBe(true)
      reentrant = flight.run(() => {
        starts.push('reentrant')
        return 'wrong'
      })
      return gate.promise
    })
    const concurrent = flight.run(() => {
      starts.push('concurrent')
      return 'wrong'
    })
    expect(starts).toEqual(['first'])
    expect(reentrant).toBe(first)
    expect(concurrent).toBe(first)
    expect(flight.promise).toBe(first)
    gate.resolve('saved')
    await expect(first).resolves.toBe('saved')
    expect(flight.isRunning).toBe(false)
    expect(flight.promise).toBeUndefined()
    await expect(flight.run(() => 'saved again')).resolves.toBe('saved again')
  })

  it.each(['synchronous', 'asynchronous'])('allows a fresh run after %s failure', async (kind) => {
    const flight = new SingleFlight<void>()
    const error = new Error('write failed')
    const failed = flight.run(() => {
      if (kind === 'synchronous') throw error
      return Promise.reject(error)
    })
    await expect(failed).rejects.toBe(error)
    expect(flight.isRunning).toBe(false)
    let retried = false
    await flight.run(() => {
      retried = true
    })
    expect(retried).toBe(true)
  })
})
