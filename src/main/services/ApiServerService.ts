import { createServer, type Server } from 'node:http'

import Logger from 'electron-log'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { v4 as uuidv4 } from 'uuid'

import { setupChatRoutes } from '../api/chat.routes'
import { setupModelsRoutes } from '../api/models.routes'
import { reduxService } from './ReduxService'

export interface ApiServerConfig {
  port: number
  apiKey: string
}

export class ApiServerService {
  private app: Hono
  private server: Server | null = null
  private config: ApiServerConfig

  constructor() {
    this.app = new Hono()
    // Initialize with default config, will be updated when starting
    this.config = {
      port: 13333,
      apiKey: `cs-${uuidv4()}`
    }
    this.setupMiddleware()
    this.setupRoutes()
  }

  private async getConfig(): Promise<ApiServerConfig> {
    try {
      const settings = reduxService.selectSync('state.settings')

      // Auto-generate API key if not set
      if (!settings?.apiServer?.apiKey) {
        const generatedKey = `cs-${uuidv4()}`
        await reduxService.dispatch({
          type: 'settings/setApiServerApiKey',
          payload: generatedKey
        })

        return {
          port: settings?.apiServer?.port ?? 13333,
          apiKey: generatedKey
        }
      }

      return {
        port: settings?.apiServer?.port ?? 13333,
        apiKey: settings.apiServer.apiKey
      }
    } catch (error) {
      Logger.warn('Failed to get settings from Redux store, using defaults:', error)
      return {
        port: 13333,
        apiKey: `cs-${uuidv4()}`
      }
    }
  }

  private setupMiddleware() {
    // CORS middleware - allow all origins for local development
    this.app.use(
      '*',
      cors({
        origin: '*',
        allowHeaders: ['Content-Type', 'Authorization'],
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
      })
    )

    // Auth middleware for all API routes
    this.app.use('/api/*', async (c, next) => {
      const auth = c.req.header('Authorization')

      if (!auth || !auth.startsWith('Bearer ')) {
        return c.json({ error: 'Authorization header required' }, 401)
      }

      const token = auth.slice(7) // Remove 'Bearer ' prefix
      const currentConfig = this.getConfigSync()
      if (token !== currentConfig.apiKey) {
        return c.json({ error: 'Invalid API key' }, 401)
      }

      return next()
    })

    // Error handling middleware
    this.app.onError((err, c) => {
      Logger.error('API Server Error:', err)
      return c.json(
        {
          error: 'Internal server error',
          message: err.message
        },
        500
      )
    })
  }

  private getConfigSync(): ApiServerConfig {
    try {
      const settings = reduxService.selectSync('state.settings')
      return {
        port: settings?.apiServer?.port ?? this.config.port,
        apiKey: settings?.apiServer?.apiKey ?? this.config.apiKey
      }
    } catch (error) {
      return this.config
    }
  }

  private setupRoutes() {
    // Health check endpoint (no auth required)
    this.app.get('/health', (c) => {
      return c.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0'
      })
    })

    // API info endpoint (no auth required)
    this.app.get('/api', (c) => {
      return c.json({
        name: 'Cherry Studio API',
        version: '1.0.0',
        endpoints: {
          health: 'GET /health',
          models: 'GET /api/models',
          chat: 'POST /api/chat/completions',
          embeddings: 'POST /api/embeddings',
          mcps: 'GET /api/mcps',
          notifications: 'POST /api/notifications'
        }
      })
    })

    // Setup route modules
    setupChatRoutes(this.app)
    setupModelsRoutes(this.app)

    // Placeholder routes (will be implemented in next steps)
    this.app.post('/api/embeddings', (c) => {
      return c.json({ message: 'Embeddings endpoint - coming soon' })
    })

    this.app.get('/api/mcps', (c) => {
      return c.json({ message: 'MCP endpoints - coming soon' })
    })

    this.app.post('/api/notifications', (c) => {
      return c.json({ message: 'Notifications endpoint - coming soon' })
    })
  }

  async start(): Promise<void> {
    // Update config from Redux store
    this.config = await this.getConfig()

    if (this.server) {
      Logger.warn('API Server is already running')
      return
    }

    try {
      this.server = createServer(async (req, res) => {
        try {
          // Convert Node.js request to Web API Request
          const url = new URL(req.url || '/', `http://${req.headers.host}`)

          let body: BodyInit | null = null
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            // Collect request body for POST/PUT requests
            const chunks: Buffer[] = []
            req.on('data', (chunk: Buffer) => {
              chunks.push(chunk)
            })

            await new Promise<void>((resolve, reject) => {
              req.on('end', () => resolve())
              req.on('error', reject)
            })

            if (chunks.length > 0) {
              body = Buffer.concat(chunks)
            }
          }

          const request = new Request(url, {
            method: req.method,
            headers: req.headers as Record<string, string>,
            body
          })

          // Process with Hono
          const response = await this.app.fetch(request)

          // Convert Web API Response to Node.js response
          res.statusCode = response.status
          for (const [key, value] of response.headers.entries()) {
            res.setHeader(key, value)
          }

          if (response.body) {
            const reader = response.body.getReader()
            const pump = async (): Promise<void> => {
              const { done, value } = await reader.read()
              if (done) {
                res.end()
              } else {
                res.write(value)
                await pump()
              }
            }
            await pump()
          } else {
            res.end()
          }
        } catch (error) {
          Logger.error('Request processing error:', error)
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Internal server error' }))
        }
      })

      this.server.listen(this.config.port, 'localhost', () => {
        Logger.info(`Cherry Studio API Server started on http://localhost:${this.config.port}`)
        Logger.info(`API Key: ${this.config.apiKey}`)
        Logger.info('Available endpoints:')
        Logger.info('  GET  /health - Health check')
        Logger.info('  GET  /api - API information')
        Logger.info('  GET  /api/models - List available models')
        Logger.info('  POST /api/chat/completions - Chat completions')
        Logger.info('  POST /api/embeddings - Generate embeddings')
        Logger.info('  GET  /api/mcps - List MCP servers')
        Logger.info('  POST /api/notifications - Send notifications')
      })
    } catch (error) {
      Logger.error('Failed to start API Server:', error)
      throw error
    }
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return
    }

    return new Promise((resolve) => {
      this.server?.close(() => {
        Logger.info('Cherry Studio API Server stopped')
        this.server = null
        resolve()
      })
    })
  }

  async restart(): Promise<void> {
    await this.stop()
    this.config = await this.getConfig()
    await this.start()
  }

  isRunning(): boolean {
    return this.server !== null
  }

  getCurrentConfig(): ApiServerConfig {
    return this.config
  }
}

// Export singleton instance
export const apiServerService = new ApiServerService()
