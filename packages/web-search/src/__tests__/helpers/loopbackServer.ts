import { readFile } from 'node:fs/promises'
import { createServer, type IncomingHttpHeaders, type ServerResponse } from 'node:http'

import { createWebSearchClient } from '../../client'
import { WebSearchTransportError } from '../../errors'
import type { WebSearchProviderModule, WebSearchTransport } from '../../types'

export type RecordedRequest = { method: string; path: string; headers: IncomingHttpHeaders; body: string }
export async function loopbackServer(body: string, status = 200, respond?: (response: ServerResponse) => void) {
  const requests: RecordedRequest[] = []
  const server = createServer(async (request, response) => {
    let bytes = ''
    for await (const chunk of request) bytes += chunk.toString()
    requests.push({ method: request.method!, path: request.url!, headers: request.headers, body: bytes })
    response.writeHead(status, {
      'Content-Type': 'application/json',
      'Retry-After': '3',
      'X-Request-Id': 'loopback-request'
    })
    if (respond) respond(response)
    else response.end(body)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing loopback port')
  return {
    host: `http://127.0.0.1:${address.port}`,
    requests,
    async close() {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    }
  }
}

export const httpTransport: WebSearchTransport = {
  async request(request) {
    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal: request.signal
      })
      return { status: response.status, headers: Object.fromEntries(response.headers), bodyText: await response.text() }
    } catch {
      if (request.signal?.aborted) throw new WebSearchTransportError('cancelled')
      throw new WebSearchTransportError('network')
    }
  }
}
export function clientFor(provider: WebSearchProviderModule) {
  return createWebSearchClient({
    transport: httpTransport,
    providers: [{ provider, capabilities: provider.metadata.capabilities.map((item) => item.capability) }]
  })
}
export function fixture(name: string): Promise<string> {
  return readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')
}
