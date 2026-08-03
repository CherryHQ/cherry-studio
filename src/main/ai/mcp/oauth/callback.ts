import { loggerService } from '@logger'
import { t } from '@main/i18n'
import type EventEmitter from 'events'
import http from 'http'
import { URL } from 'url'

import type { OAuthCallbackServerOptions } from './types'

const logger = loggerService.withContext('Mcp:OAuthCallbackServer')

export class CallBackServer {
  private server: Promise<http.Server>
  private events: EventEmitter

  constructor(options: OAuthCallbackServerOptions) {
    const { port, path, events } = options
    this.events = events
    this.server = this.initialize(port, path)
  }

  initialize(port: number, path: string): Promise<http.Server> {
    const server = http.createServer((req, res) => {
      // Only handle requests to the callback path
      if (req.url?.startsWith(path)) {
        try {
          // Keep every callback parameter so the SDK can validate `iss` and
          // complete the authorization-server-bound exchange.
          const url = new URL(req.url, `http://127.0.0.1:${port}`)
          if (url.searchParams.has('code') || url.searchParams.has('error')) {
            this.events.emit('auth-callback-received', new URLSearchParams(url.searchParams))
            // Send success response to browser
            const title = t('settings.mcp.oauth.callback.title')
            const message = t('settings.mcp.oauth.callback.message')

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end(`
              <!DOCTYPE html>
              <html>
                <head>
                  <meta charset="utf-8">
                  <title>${title}</title>
                  <style>
                    body {
                      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                      display: flex;
                      justify-content: center;
                      align-items: center;
                      height: 100vh;
                      margin: 0;
                      background: #ffffff;
                    }
                    .container {
                      text-align: center;
                      padding: 2rem;
                    }
                    h1 {
                      color: #2d3748;
                      margin: 0 0 0.5rem 0;
                      font-size: 24px;
                      font-weight: 600;
                    }
                    p {
                      color: #718096;
                      margin: 0;
                      font-size: 14px;
                    }
                  </style>
                </head>
                <body>
                  <div class="container">
                    <h1>${title}</h1>
                    <p>${message}</p>
                  </div>
                </body>
              </html>
            `)
          } else {
            res.writeHead(400, { 'Content-Type': 'text/plain' })
            res.end('Missing OAuth callback parameters')
          }
        } catch (error) {
          logger.error('Error processing OAuth callback:', error as Error)
          res.writeHead(500, { 'Content-Type': 'text/plain' })
          res.end('Internal Server Error')
        }
      } else {
        // Not a callback request
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('Not Found')
      }
    })

    // Handle server errors
    server.on('error', (error) => {
      logger.error('OAuth callback server error:', error)
    })

    return new Promise<http.Server>((resolve, reject) => {
      server.listen(port, '127.0.0.1', () => {
        logger.info(`OAuth callback server listening on 127.0.0.1:${port}`)
        resolve(server)
      })

      server.on('error', (error) => {
        reject(error)
      })
    })
  }

  get getServer(): Promise<http.Server> {
    return this.server
  }

  async close(): Promise<void> {
    const server = await this.server
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }

  /**
   * Resolve with the OAuth authorization code, or reject if none arrives within
   * `timeoutMs`. Without the reject path the caller's `await` hangs forever on a
   * cancelled / never-completed callback, leaking the connect attempt and its status.
   */
  async waitForAuthCallback(timeoutMs = 300_000): Promise<URLSearchParams> {
    return new Promise((resolve, reject) => {
      const onCallback = (params: URLSearchParams) => {
        clearTimeout(timer)
        resolve(params)
      }
      const timer = setTimeout(() => {
        this.events.off('auth-callback-received', onCallback)
        reject(new Error(`Timed out waiting for OAuth callback after ${Math.round(timeoutMs / 1000)}s`))
      }, timeoutMs)
      this.events.once('auth-callback-received', onCallback)
    })
  }
}
