import { ErrorHandler } from 'hono'

import { loggerService } from '../../services/LoggerService'

const logger = loggerService.withContext('ApiServerErrorHandler')

export const errorHandler: ErrorHandler = (err, c) => {
  logger.error('API Server Error:', err)

  // Don't expose internal errors in production
  const isDev = process.env.NODE_ENV === 'development'

  return c.json(
    {
      error: {
        message: isDev ? err.message : 'Internal server error',
        type: 'server_error',
        ...(isDev && { stack: err.stack })
      }
    },
    500
  )
}
