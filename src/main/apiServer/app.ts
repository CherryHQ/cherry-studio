import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { prettyJSON } from 'hono/pretty-json'
import { requestId } from 'hono/request-id'
import { timing } from 'hono/timing'

import { authMiddleware } from './middleware/auth'
import { errorHandler } from './middleware/error'
import { chatRoutes } from './routes/chat'
import { modelsRoutes } from './routes/models'

const app = new Hono()

// Global middleware
app.use(timing())
app.use(requestId())
app.use(logger())
app.use(prettyJSON())
app.use(
  cors({
    origin: '*',
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  })
)

// Error handling
app.onError(errorHandler)

// Health check (no auth required)
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0'
  })
})

// API v1 routes with auth
const api = app.basePath('/v1').use(authMiddleware)

// API info
api.get('/', (c) => {
  return c.json({
    name: 'Cherry Studio API',
    version: '1.0.0',
    endpoints: {
      health: 'GET /health',
      models: 'GET /v1/models',
      chat: 'POST /v1/chat/completions'
    }
  })
})

// Mount routes
api.route('/chat', chatRoutes)
api.route('/models', modelsRoutes)

export { app }
