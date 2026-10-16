import { net } from 'electron'

import { WebSearchTransportError, type WebSearchTransport } from '@cherrystudio/web-search'
import { defaultAppHeaders, mergeHeaders } from '@main/utils/http'

export const electronWebSearchTransport: WebSearchTransport = {
  async request(request) {
    const deadline = request.timeoutMs === undefined ? undefined : new AbortController()
    const timer = deadline ? setTimeout(() => deadline.abort(), request.timeoutMs) : undefined
    const signal = deadline
      ? AbortSignal.any([deadline.signal, ...(request.signal ? [request.signal] : [])])
      : request.signal
    try {
      request.signal?.throwIfAborted()
      const response = await net.fetch(request.url, {
        method: request.method,
        headers: mergeHeaders(defaultAppHeaders(), request.headers),
        body: request.body,
        signal
      })
      const bodyText = await response.text()
      request.signal?.throwIfAborted()
      if (deadline?.signal.aborted) throw new WebSearchTransportError('timeout')
      return {
        status: response.status,
        headers: Object.fromEntries([...response.headers].map(([key, value]) => [key.toLowerCase(), value])),
        bodyText
      }
    } catch {
      request.signal?.throwIfAborted()
      throw new WebSearchTransportError(deadline?.signal.aborted ? 'timeout' : 'network')
    } finally {
      clearTimeout(timer)
    }
  }
}
