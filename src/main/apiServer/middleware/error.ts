import { NextFunction, Request, Response } from 'express'

import { loggerService } from '../../services/LoggerService'

const logger = loggerService.withContext('ApiServerErrorHandler')

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler = (err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error('API Server Error:', err)

  // Don't expose internal errors in production
  const isDev = process.env.NODE_ENV === 'development'

  res.status(500).json({
    error: {
      message: isDev ? err.message : 'Internal server error',
      type: 'server_error',
      ...(isDev && { stack: err.stack })
    }
  })
}
