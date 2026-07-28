import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

import { OAuthServiceError } from '../errors'
import type { LoopbackCallbackConfig } from './types'

export class LoopbackCallbackTransport {
  private activeServers: Server[] = []
  private busy = false

  constructor(private readonly config: LoopbackCallbackConfig) {}

  get isActive(): boolean {
    return this.busy
  }

  /**
   * Atomically reserve this transport for one sign-in. Returns `false` if a
   * flow is already in progress. Must be called *synchronously* before any
   * `await` in the caller — checking `isActive` and then awaiting `createClient`
   * leaves a window where a second sign-in slips through, binds the same port,
   * hits `EADDRINUSE`, and its error handler `close()`s the shared servers,
   * killing the first flow mid-callback.
   */
  tryAcquire(): boolean {
    if (this.busy) return false
    this.busy = true
    return true
  }

  close(): void {
    for (const server of this.activeServers) {
      server.close()
    }
    this.activeServers = []
    this.busy = false
  }

  waitForAuthorizationCode(expectedState: string, signal: AbortSignal): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      // `AbortSignal.timeout` has no cancel: its internal timer fires ~10 min
      // later no matter what. Without this latch the stale abort would
      // `close()` the *shared* transport, tearing down a later sign-in's servers
      // mid-flight. Settle exactly once so a fired timer (or any late callback)
      // is a no-op.
      let settled = false
      const settleResolve = (code: string) => {
        if (settled) return
        settled = true
        resolve(code)
      }
      const settleReject = (error: unknown) => {
        if (settled) return
        settled = true
        this.close()
        reject(error)
      }

      const handleRequest = (req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url ?? '', this.config.redirectUri)
        if (url.pathname !== this.config.path) {
          res.writeHead(404).end()
          return
        }

        const error = url.searchParams.get('error')
        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')

        const respond = (message: string) => {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(
            `<!doctype html><html><body style="font-family:system-ui;text-align:center;padding-top:64px">` +
              `<h2>${message}</h2><p>You can close this window and return to Cherry Studio.</p></body></html>`
          )
        }

        if (error) {
          respond('Sign-in failed')
          settleReject(new OAuthServiceError(`OAuth provider returned error: ${error}`))
          return
        }
        if (!state || state !== expectedState) {
          respond('Sign-in failed')
          settleReject(new OAuthServiceError('OAuth callback state mismatch'))
          return
        }
        if (!code) {
          respond('Sign-in failed')
          settleReject(new OAuthServiceError('No authorization code received'))
          return
        }

        respond('Signed in successfully')
        settleResolve(code)
      }

      const listen = (host: string) =>
        new Promise<void>((resolveListen, rejectListen) => {
          const server = createServer(handleRequest)
          this.activeServers.push(server)

          server.once('listening', resolveListen)
          server.once('error', (err: NodeJS.ErrnoException) => {
            this.activeServers = this.activeServers.filter((activeServer) => activeServer !== server)
            server.close()
            if (host === '::1' && err.code === 'EADDRNOTAVAIL') {
              resolveListen()
              return
            }
            rejectListen(
              new OAuthServiceError(
                `Failed to start OAuth callback server on ${host}:${this.config.port}: ${err.message}`,
                err
              )
            )
          })

          server.listen(this.config.port, host)
        })

      void Promise.all(this.config.hosts.map(listen)).catch(settleReject)
      signal.addEventListener('abort', () => settleReject(new OAuthServiceError('Sign-in timed out')), { once: true })
    })
  }
}
