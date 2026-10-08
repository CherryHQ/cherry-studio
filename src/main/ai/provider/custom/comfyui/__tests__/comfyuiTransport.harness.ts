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

/** Every POST a mock received, with its parsed body. */
export const postWrites = (doFetch: { mock: { calls: [RequestInfo | URL, RequestInit?][] } }) =>
  doFetch.mock.calls
    .filter(([, init]) => init?.method === 'POST')
    .map(([input, init]) => ({ url: String(input), body: JSON.parse(init?.body as string) }))
