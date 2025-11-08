import { loggerService } from '@logger'
import { configManager } from '@main/services/ConfigManager'
import { locales } from '@main/utils/locales'
import type EventEmitter from 'events'
import http from 'http'
import { URL } from 'url'

import type { OAuthCallbackServerOptions } from './types'

const logger = loggerService.withContext('MCP:OAuthCallbackServer')

function getTranslation(key: string): string {
  const language = configManager.getLanguage()
  const localeData = locales[language]

  if (!localeData) {
    logger.warn(`No locale data found for language: ${language}`)
    return key
  }

  const translations = localeData.translation as any
  if (!translations) {
    logger.warn(`No translations found for language: ${language}`)
    return key
  }

  const keys = key.split('.')
  let value = translations

  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = value[k]
    } else {
      logger.warn(`Translation key not found: ${key} (failed at: ${k})`)
      return key // fallback to key if translation not found
    }
  }

  return typeof value === 'string' ? value : key
}

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
            // Send success response to browser
            const title = getTranslation('settings.mcp.oauth.callback.title')
            const message = getTranslation('settings.mcp.oauth.callback.message')

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
            res.end('Missing authorization code')
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
