import { readFileSync } from 'node:fs'
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { join } from 'node:path'

export type TestHttpHandler = (req: IncomingMessage, res: ServerResponse) => void

export interface TestHttpServer {
  readonly url: string
  readonly host: string
  readonly port: number
  close(): Promise<void>
}

const FIXTURES = join(import.meta.dirname, '../../../src/main/services/__tests__/fixtures')

/** Self-signed leaf for `127.0.0.1`; every verifier rejects it, which is the point. */
const TEST_TLS_CREDENTIALS = {
  key: readFileSync(join(FIXTURES, 'self-signed-key.pem')),
  cert: readFileSync(join(FIXTURES, 'self-signed-cert.pem'))
}

function listen(server: Server, scheme: 'http' | 'https'): Promise<TestHttpServer> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number }
      resolve({
        url: `${scheme}://127.0.0.1:${port}`,
        host: '127.0.0.1',
        port,
        close: () => new Promise((done) => server.close(() => done()))
      })
    })
  })
}

const respondOk: TestHttpHandler = (_req, res) => res.writeHead(200).end()

/** Real loopback HTTP server on a random port; the default handler answers 200. */
export function startTestHttpServer(handler: TestHttpHandler = respondOk): Promise<TestHttpServer> {
  return listen(createHttpServer(handler), 'http')
}

/** Real loopback HTTPS server with the self-signed test certificate. */
export function startTestHttpsServer(handler: TestHttpHandler = respondOk): Promise<TestHttpServer> {
  return listen(createHttpsServer(TEST_TLS_CREDENTIALS, handler), 'https')
}

/** A port nothing listens on, for "connection refused" cases. */
export async function unusedPort(): Promise<number> {
  const probe = await startTestHttpServer()
  await probe.close()
  return probe.port
}
