import { net } from 'electron'

import { WebSearchTransportError, type WebSearchTransport } from '@cherrystudio/web-search'
import { defaultAppHeaders } from '@main/utils/http'

export const electronWebSearchTransport: WebSearchTransport = {
  async request(request) {
    if (request.signal?.aborted)
      throw new WebSearchTransportError('cancelled', 'Web search cancelled', { cause: request.signal.reason })
    const controller = new AbortController()
    const forwardAbort = () => controller.abort(request.signal?.reason)
    request.signal?.addEventListener('abort', forwardAbort, { once: true })
    if (request.signal?.aborted) forwardAbort()
    let timedOut = false
    const timeout =
      request.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true
            controller.abort()
          }, request.timeoutMs)
    try {
      const response = await net.fetch(request.url, {
        method: request.method,
        headers: { ...defaultAppHeaders(), ...request.headers },
        body: request.body,
        signal: request.timeoutMs === undefined ? request.signal : controller.signal
      })
      const bodyText = await response.text()
      if (controller.signal.aborted) throw controller.signal.reason
      const headers: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value
      })
      return { status: response.status, headers, bodyText }
    } catch (cause) {
      const kind = request.signal?.aborted ? 'cancelled' : timedOut ? 'timeout' : 'network'
      throw new WebSearchTransportError(kind, `Web search transport failed (${kind})`, { cause })
    } finally {
      if (timeout !== undefined) clearTimeout(timeout)
      request.signal?.removeEventListener('abort', forwardAbort)
    }
  }
}
