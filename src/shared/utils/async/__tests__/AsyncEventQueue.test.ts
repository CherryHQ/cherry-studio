import { describe, expect, it } from 'vitest'

import { AsyncEventQueue } from '..'

describe('AsyncEventQueue', () => {
  it('drains every buffered value in order after close, including falsy values', async () => {
    const queue = new AsyncEventQueue<unknown>()
    for (const value of [0, false, '', null, undefined, 'last']) queue.push(value)
    queue.close()
    queue.push('ignored')
    const received: unknown[] = []
    for await (const value of queue) received.push(value)
    expect(received).toEqual([0, false, '', null, undefined, 'last'])
  })

  it('delivers to pending readers in order and settles remaining readers on close', async () => {
    const queue = new AsyncEventQueue<number>()
    const iterator = queue[Symbol.asyncIterator]()
    const first = iterator.next()
    const second = iterator.next()
    queue.push(0)
    queue.close()
    await expect(first).resolves.toEqual({ value: 0, done: false })
    await expect(second).resolves.toEqual({ value: undefined, done: true })
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true })
  })
})
