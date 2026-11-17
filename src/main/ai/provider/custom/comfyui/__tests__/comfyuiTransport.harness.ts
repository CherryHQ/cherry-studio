import { vi } from 'vitest'

export const respond = (data: unknown) => new Response(JSON.stringify(data), { status: 200 })

/** Headers arrive immediately; the body never does until the request's signal aborts. */
export const stallingResponse = (init?: RequestInit, contentType = 'application/json') =>
  new Response(
    new ReadableStream({
      start(controller) {
        ;(init?.signal as AbortSignal | undefined)?.addEventListener(
          'abort',
          () => {
            const e = new Error('The operation was aborted')
            e.name = 'AbortError'
            controller.error(e)
          },
          { once: true }
        )
      }
    }),
    { status: 200, headers: { 'Content-Type': contentType } }
  )

/** `/system_stats` body for a given server version. */
export const systemStats = (version: string) =>
  respond({
    system: { comfyui_version: version },
    devices: []
  })

/** A fetch mock that serves `/system_stats` at `version` and `/queue` with the
 *  given running / pending queues. Every write (queue delete, interrupt) is
 *  answered with `{}` and recorded, so a test can assert what was sent. */
export const createCapsFetch = (version: string, running: unknown[][], pending: unknown[][]) => {
  const doFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/system_stats')) return systemStats(version)
    if (url.includes('/queue')) {
      if (init?.method === 'POST') return respond({})
      return respond({ queue_running: running, queue_pending: pending })
    }
    if (url.includes('/interrupt')) return respond({})
    return respond({})
  })
  return doFetch
}

/** Staging for the race between `GET /queue` (the cancellation snapshot) and
 *  `GET /system_stats` (the capability probe): the first queue read shows
 *  `initialRunning`, the probe flips the server to `staleRunning`. */
export const createStaleQueueFetch = (initialRunning: unknown[][], staleRunning: unknown[][]) => {
  let currentState = initialRunning
  const doFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/queue')) {
      if (init?.method === 'POST') return respond({})
      return respond({ queue_running: currentState, queue_pending: [] })
    }
    if (url.includes('/system_stats')) {
      currentState = staleRunning
      return systemStats('0.3.40') // old version
    }
    if (url.includes('/interrupt')) return respond({})
    return respond({})
  })
  return { doFetch, getCurrentState: () => currentState }
}

/** Every POST a mock received, with its parsed body. */
export const postWrites = (doFetch: { mock: { calls: [RequestInfo | URL, RequestInit?][] } }) =>
  doFetch.mock.calls
    .filter(([, init]) => init?.method === 'POST')
    .map(([input, init]) => ({ url: String(input), body: JSON.parse(init?.body as string) }))
