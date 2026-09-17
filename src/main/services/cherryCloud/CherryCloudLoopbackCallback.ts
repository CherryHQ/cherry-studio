import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

const LOOPBACK_HOST = '127.0.0.1'
const CALLBACK_PATH = '/cloud-auth/callback'
const STARTUP_TIMEOUT_MS = 60_000
type CompletionResult = 'success' | 'failure' | 'invalid'

export class CherryCloudLoopbackCallback {
  private timeout: NodeJS.Timeout | null = null
  private handled = false
  private closed = false

  private constructor(
    private readonly server: Server,
    public readonly port: number,
    private readonly callback: (url: URL) => Promise<void>,
    private readonly completionOrigin: string
  ) {
    this.setTimeout(STARTUP_TIMEOUT_MS)
  }

  public static async open(
    callback: (url: URL) => Promise<void>,
    completionOrigin: string
  ): Promise<CherryCloudLoopbackCallback> {
    const server = createServer()

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error)
      server.once('error', onError)
      server.listen(0, LOOPBACK_HOST, () => {
        server.removeListener('error', onError)
        resolve()
      })
    })

    const address = server.address()
    if (!address || typeof address === 'string') {
      server.close()
      throw new Error('Cherry Cloud loopback callback did not bind a TCP port')
    }
    server.unref()
    const receiver = new CherryCloudLoopbackCallback(server, address.port, callback, completionOrigin)
    server.on('request', (request, response) => {
      void receiver.handleRequest(request, response)
    })
    return receiver
  }

  public setExpiresAt(value: string): void {
    const expiresAt = Date.parse(value)
    if (!Number.isFinite(expiresAt)) throw new Error('Cherry Cloud authorization expiry is invalid')
    this.setTimeout(Math.max(0, expiresAt - Date.now()))
  }

  public dispose(): void {
    if (this.closed) return
    this.closed = true
    if (this.timeout) clearTimeout(this.timeout)
    this.timeout = null
    this.server.close()
  }

  private setTimeout(delay: number): void {
    if (this.timeout) clearTimeout(this.timeout)
    this.timeout = setTimeout(() => this.dispose(), delay)
    this.timeout.unref()
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const target = new URL(request.url ?? '/', `http://${LOOPBACK_HOST}:${this.port}`)
    if (this.handled || request.method !== 'GET' || target.pathname !== CALLBACK_PATH) {
      response.writeHead(this.handled ? 410 : 404, { 'Cache-Control': 'no-store' }).end()
      return
    }

    try {
      await this.callback(target)
      this.handled = true
      this.dispose()
      this.redirectToCompletion(response, target.searchParams.has('error') ? 'failure' : 'success')
    } catch {
      this.redirectToCompletion(response, 'invalid')
    }
  }

  private redirectToCompletion(response: ServerResponse, result: CompletionResult): void {
    const location = new URL('/login/complete', this.completionOrigin)
    location.hash = new URLSearchParams({ desktop_result: result }).toString()
    response
      .writeHead(303, {
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        Location: location.toString()
      })
      .end()
  }
}
