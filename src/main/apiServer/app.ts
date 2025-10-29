import { loggerService } from '@main/services/LoggerService'
import cors from 'cors'
import express from 'express'
import { v4 as uuidv4 } from 'uuid'

import { LONG_POLL_TIMEOUT_MS } from './config/timeouts'
import { authMiddleware } from './middleware/auth'
import { errorHandler } from './middleware/error'
import { setupOpenAPIDocumentation } from './middleware/openapi'
import { agentsRoutes } from './routes/agents'
import { chatRoutes } from './routes/chat'
import { mcpRoutes } from './routes/mcp'
import { messagesProviderRoutes, messagesRoutes } from './routes/messages'
import { modelsRoutes } from './routes/models'

const logger = loggerService.withContext('ApiServer')

const extendMessagesTimeout: express.RequestHandler = (req, res, next) => {
  req.setTimeout(LONG_POLL_TIMEOUT_MS)
  res.setTimeout(LONG_POLL_TIMEOUT_MS)
  next()
}

const app = express()
app.use(
  express.json({
    limit: '50mb'
  })
)

// Global middleware
app.use((req, res, next) => {
  const start = Date.now()
  res.on('finish', () => {
    const duration = Date.now() - start
    logger.info('API request completed', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: duration
    })
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

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health check endpoint
 *     description: Check server status (no authentication required)
 *     tags: [Health]
 *     security: []
 *     responses:
 *       200:
 *         description: Server is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 version:
 *                   type: string
 *                   example: 1.0.0
 */
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0'
  })
})

/**
 * @swagger
 * /:
 *   get:
 *     summary: API information
 *     description: Get basic API information and available endpoints
 *     tags: [General]
 *     security: []
 *     responses:
 *       200:
 *         description: API information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 name:
 *                   type: string
 *                   example: Cherry Studio API
 *                 version:
 *                   type: string
 *                   example: 1.0.0
 *                 endpoints:
 *                   type: object
 */
app.get('/', (_req, res) => {
  res.json({
    name: 'Cherry Studio API',
    version: '1.0.0',
    endpoints: {
      health: 'GET /health'
    }
  })
})

// Setup OpenAPI documentation before protected routes so docs remain public
setupOpenAPIDocumentation(app)

// Provider-specific messages route requires authentication
app.use('/:provider/v1/messages', authMiddleware, extendMessagesTimeout, messagesProviderRoutes)

// API v1 routes with auth
const apiRouter = express.Router()
apiRouter.use(authMiddleware)
// Mount routes
apiRouter.use('/chat', chatRoutes)
apiRouter.use('/mcps', mcpRoutes)
apiRouter.use('/messages', extendMessagesTimeout, messagesRoutes)
apiRouter.use('/models', modelsRoutes)
apiRouter.use('/agents', agentsRoutes)
app.use('/v1', apiRouter)

// Error handling (must be last)
app.use(errorHandler)

export { app }
