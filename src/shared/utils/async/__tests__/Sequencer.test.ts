import { afterEach, describe, expect, it, vi } from 'vitest'

import { Sequencer, SequencerByKey } from '..'

afterEach(() => vi.useRealTimers())

describe('sequences', () => {
  it('runs every task in order even after its predecessor fails', async () => {
    const sequence = new Sequencer()
    const gate = Promise.withResolvers<void>()
    const order: string[] = []
    const first = sequence.queue(async () => {
      order.push('first')
      await gate.promise
      throw new Error('failed')
    })
    const second = sequence.queue(() => {
      order.push('second')
      return 'result'
    })
    const rejected = expect(first).rejects.toThrow('failed')
    await Promise.resolve()
    expect(order).toEqual(['first'])
    gate.resolve()
    await rejected
    await expect(second).resolves.toBe('result')
    expect(order).toEqual(['first', 'second'])
  })

  it('isolates keys, preserves same-key order, and flushes unsettled work after failure', async () => {
    const sequence = new SequencerByKey<string>()
    const gate = Promise.withResolvers<void>()
    const order: string[] = []
    const first = sequence.queue('a', async () => {
      await gate.promise
      throw new Error('failed')
    })
    const rejected = expect(first).rejects.toThrow('failed')
    const second = sequence.queue('a', () => {
      order.push('a')
      return 'saved'
    })
    await sequence.queue('b', () => order.push('b'))
    await sequence.flush('b')
    expect(order).toEqual(['b'])
    let flushed = false
    const flushing = sequence.flush().then(() => {
      flushed = true
    })
    await Promise.resolve()
    expect(flushed).toBe(false)
    gate.resolve()
    await rejected
    await flushing
    await expect(second).resolves.toBe('saved')
    expect(order).toEqual(['b', 'a'])
  })
})
