import { afterEach, describe, expect, it, vi } from 'vitest'

import { createRequestStreamTransport } from '../requestStreamTransport'

describe('request stream transport', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('settles a pending read when a signal-ignoring fetch honors body cancellation', async () => {
    const transport = createRequestStreamTransport()
    let cancelled = false
    const response = await transport.wrapFetch(
      async () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true
            }
          })
        )
    )('https://example.com')
    const read = response.body!.getReader().read()
    await transport.close()
    expect(await read).toEqual({ done: true, value: undefined })
    expect(cancelled).toBe(true)
  })

  it('reports a late body cancellation failure after settling its request', async () => {
    const transport = createRequestStreamTransport()
    let deliver!: (response: Response) => void
    let started!: () => void
    const entered = new Promise<void>((resolve) => {
      started = resolve
    })
    const request = transport.wrapFetch(async () => {
      started()
      return new Promise<Response>((resolve) => {
        deliver = resolve
      })
    })('https://example.com')
    await entered
    const failure = new Error('cancel failed')
    const closing = transport.close(new Error('provider failure'))
    const requestResult = request.catch((error: unknown) => error)
    deliver(
      new Response(
        new ReadableStream({
          cancel() {
            throw failure
          }
        })
      )
    )
    await expect(closing).rejects.toMatchObject({ errors: [failure] })
    expect(await requestResult).toBe(failure)
  })

  it('settles a wrapper reader even when body cancellation rejects', async () => {
    const transport = createRequestStreamTransport()
    const failure = new Error('cancel failed')
    let rawBody!: ReadableStream<Uint8Array>
    const response = await transport.wrapFetch(async () => {
      rawBody = new ReadableStream({
        cancel() {
          throw failure
        }
      })
      return new Response(rawBody)
    })('https://example.com')
    const read = response.body!.getReader().read()
    await expect(transport.close()).rejects.toMatchObject({ errors: [failure] })
    expect(rawBody.locked).toBe(false)
    expect(await read).toEqual({ done: true, value: undefined })
  })

  it.each(['rejects', 'never settles'])(
    'retains a lock release failure when cancellation %s',
    async (outcome) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const transport = createRequestStreamTransport({ cleanupTimeoutMs: 20 })
      const cancelFailure = new Error('cancel failed')
      const releaseFailure = new Error('release failed')
      const cancelled = Promise.withResolvers<unknown>()
      const rawBody = new ReadableStream<Uint8Array>({
        cancel(reason) {
          cancelled.resolve(reason)
          if (outcome === 'rejects') throw cancelFailure
          return new Promise<void>(() => {})
        }
      })
      const rawResponse = new Response(rawBody)
      const reader = rawBody.getReader()
      vi.spyOn(rawBody, 'getReader').mockReturnValue(reader)
      vi.spyOn(reader, 'releaseLock').mockImplementation(() => {
        throw releaseFailure
      })
      const response = await transport.wrapFetch(async () => rawResponse)('https://example.com')
      const read = response.body!.getReader().read()
      const reason = new Error('provider failed')
      const closing = transport.close(reason)
      const closeResult = closing.catch((error: unknown) => error)
      expect(transport.close()).toBe(closing)
      expect(transport.signal.reason).toBe(reason)
      await expect(cancelled.promise).resolves.toBe(reason)
      await expect(read).resolves.toMatchObject({ done: true })
      await vi.advanceTimersByTimeAsync(20)
      expect(await closeResult).toMatchObject({
        name: 'AggregateError',
        errors: [
          outcome === 'rejects'
            ? cancelFailure
            : expect.objectContaining({ name: 'TimeoutError', message: expect.stringContaining('20 ms') }),
          releaseFailure
        ]
      })
    },
    1000
  )

  it('bounds a pending fetch and cancels its response if it arrives after the deadline', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const transport = createRequestStreamTransport({ cleanupTimeoutMs: 20 })
    const entered = Promise.withResolvers<void>()
    const response = Promise.withResolvers<Response>()
    const request = transport.wrapFetch(() => {
      entered.resolve()
      return response.promise
    })('https://example.com')
    await entered.promise
    const reason = new Error('Stop')
    const requestResult = request.catch((error: unknown) => error)
    const closeResult = transport.close(reason).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(20)
    expect(await closeResult).toMatchObject({
      errors: [expect.objectContaining({ name: 'TimeoutError' })]
    })

    const cancelled = Promise.withResolvers<unknown>()
    const rawBody = new ReadableStream({
      cancel(reason) {
        cancelled.resolve(reason)
        return new Promise<void>(() => {})
      }
    })
    response.resolve(new Response(rawBody))
    expect(await requestResult).toBe(reason)
    await expect(cancelled.promise).resolves.toBe(reason)
    expect(rawBody.locked).toBe(false)
  }, 1000)

  it('tracks a request when fetch closes the transport reentrantly', async () => {
    const transport = createRequestStreamTransport()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let closing!: Promise<void>
    let cancellationStarted!: () => void
    const entered = new Promise<void>((resolve) => {
      cancellationStarted = resolve
    })
    let cancelled = false
    const request = transport
      .wrapFetch(async () => {
        closing = transport.close()
        return new Response(
          new ReadableStream({
            async cancel() {
              cancellationStarted()
              await gate
              cancelled = true
            }
          })
        )
      })('https://example.com')
      .catch(() => {})
    await entered
    let settled = false
    void closing.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    release()
    await closing
    await request
    expect(cancelled).toBe(true)
  })

  it('publishes the same close promise before abort listeners run', async () => {
    const transport = createRequestStreamTransport()
    let reentrant: Promise<void> | undefined
    transport.signal.addEventListener('abort', () => {
      reentrant = transport.close()
    })
    const closing = transport.close(new Error('stop'))
    expect(reentrant).toBe(closing)
    await closing
  })

  it('cancels an owned body before waiting for a dependent pending fetch', async () => {
    const transport = createRequestStreamTransport()
    let release!: () => void
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    await transport.wrapFetch(async () => new Response(new ReadableStream({ cancel: release })))('https://example.com')
    let started!: () => void
    const entered = new Promise<void>((resolve) => {
      started = resolve
    })
    const pending = transport
      .wrapFetch(async () => {
        started()
        await released
        return new Response()
      })('https://example.com/dependent')
      .catch(() => {})
    await entered
    await transport.close()
    await pending
  })

  it('aborts a request without a caller signal and cancels owned bodies concurrently', async () => {
    const transport = createRequestStreamTransport()
    let cancelled = false
    await transport.wrapFetch(
      async () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true
            }
          })
        )
    )('https://example.com')
    let started!: () => void
    const entered = new Promise<void>((resolve) => {
      started = resolve
    })
    let receivedSignal: AbortSignal | undefined
    const repair = transport.wrapFetch(async (_input, init) => {
      receivedSignal = init?.signal ?? undefined
      started()
      return new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason))
      })
    })('https://example.com/repair')
    await entered
    expect(receivedSignal).toBeInstanceOf(AbortSignal)
    const reason = new Error('stop repair')
    const rejected = expect(repair).rejects.toBe(reason)
    await transport.close(reason)
    await rejected
    expect(cancelled).toBe(true)
  })

  it('retains the final response URL', async () => {
    const transport = createRequestStreamTransport()
    const raw = new Response('body')
    Object.defineProperty(raw, 'url', { value: 'https://example.com/final' })
    const response = await transport.wrapFetch(async () => raw)('https://example.com')
    expect(response.url).toBe('https://example.com/final')
    await response.text()
    await transport.close()
  })
})
