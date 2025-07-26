import { loggerService } from '@logger'
import EventEmitter from 'events'
import http from 'http'
import { URL } from 'url'

import { OAuthCallbackServerOptions } from './types'

const logger = loggerService.withContext('MCP:OAuthCallbackServer')

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
          // Parse the URL to extract the authorization code
          const url = new URL(req.url, `http://127.0.0.1:${port}`)
          const code = url.searchParams.get('code')
          if (code) {
            // Emit the code event
            this.events.emit('auth-code-received', code)
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
      logger.error('OAuth callback server error:', error as Error)
    })

    return new Promise<http.Server>((resolve, reject) => {
      server.listen(port, () => {
        logger.info(`OAuth callback server listening on port ${port}`)
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

  async close() {
    const server = await this.server
    server.close()
  }

  async waitForAuthCode(): Promise<string> {
    return new Promise((resolve) => {
      this.events.once('auth-code-received', (code) => {
        resolve(code)
      })
    })
  }
}
