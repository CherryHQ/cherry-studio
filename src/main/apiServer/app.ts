import { loggerService } from '@main/services/LoggerService'
import cors from 'cors'
import express from 'express'
import { v4 as uuidv4 } from 'uuid'

import { authMiddleware } from './middleware/auth'
import { errorHandler } from './middleware/error'
import { chatRoutes } from './routes/chat'
import { mcpRoutes } from './routes/mcp'
import { modelsRoutes } from './routes/models'

const logger = loggerService.withContext('ApiServer')

const app = express()

// Global middleware
app.use((req, res, next) => {
  const start = Date.now()
  res.on('finish', () => {
    const duration = Date.now() - start
    logger.info(`${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`)
  })
  next()
})

app.use((_req, res, next) => {
  res.setHeader('X-Request-ID', uuidv4())
  next()
})

app.use(
  cors({
    origin: '*',
    allowedHeaders: ['Content-Type', 'Authorization'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  })
)

// Health check (no auth required)
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0'
  })
})
// API info
app.get('/', (_req, res) => {
  res.json({
    name: 'Cherry Studio API',
    version: '1.0.0',
    endpoints: {
      health: 'GET /health',
      models: 'GET /v1/models',
      chat: 'POST /v1/chat/completions',
      mcp: 'GET /v1/mcps'
    }
  })
})

// API v1 routes with auth
const apiRouter = express.Router()
apiRouter.use(authMiddleware)
apiRouter.use(express.json())
// Mount routes
apiRouter.use('/chat', chatRoutes)
apiRouter.use('/mcps', mcpRoutes)
apiRouter.use('/models', modelsRoutes)
app.use('/v1', apiRouter)

// Error handling (must be last)
app.use(errorHandler)

export { app }
