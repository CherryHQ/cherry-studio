import { once } from 'node:events'
import { createServer } from 'node:http'

import { stringify } from 'yaml'

export async function startMockUpdateServer(feedUrl: string, version: string) {
  const url = new URL(feedUrl)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') {
    throw new Error('The development update fixture requires an HTTP feed on 127.0.0.1')
  }
  const basePath = url.pathname.replace(/\/?$/, '/')
  const requests: string[] = []
  const metadata = stringify({ version, files: [], releaseDate: '2026-01-01T00:00:00.000Z' })
  const server = createServer((request, response) => {
    const pathname = new URL(request.url!, url).pathname
    requests.push(pathname)
    const filename = pathname.slice(basePath.length)
    if (request.method === 'GET' && pathname.startsWith(basePath) && /^[\w-]+\.yml$/.test(filename)) {
      response.writeHead(200, { 'Content-Type': 'application/yaml', 'Cache-Control': 'no-store' }).end(metadata)
    } else {
      response.writeHead(404).end()
    }
  })
  server.listen(Number(url.port || 80), url.hostname)
  await once(server, 'listening')
  return {
    requests,
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    }
  }
}
