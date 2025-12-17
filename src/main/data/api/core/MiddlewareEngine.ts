import { loggerService } from '@logger'
import type { DataRequest, DataResponse, Middleware, RequestContext } from '@shared/data/api/apiTypes'
import { toDataApiError } from '@shared/data/api/errorCodes'

const logger = loggerService.withContext('MiddlewareEngine')

/**
 * Middleware engine for executing middleware chains
 * Extracted from ResponseService to support reusability
 */
export class MiddlewareEngine {
  private middlewares = new Map<string, Middleware>()
  private middlewareOrder: string[] = []

  constructor() {
    this.setupDefaultMiddlewares()
  }

  /**
   * Register middleware
   */
  use(middleware: Middleware): void {
    this.middlewares.set(middleware.name, middleware)

    // Insert based on priority
    const priority = middleware.priority || 50
    let insertIndex = 0

    for (let i = 0; i < this.middlewareOrder.length; i++) {
      const existingMiddleware = this.middlewares.get(this.middlewareOrder[i])
      const existingPriority = existingMiddleware?.priority || 50

      if (priority < existingPriority) {
        insertIndex = i
        break
      }
      insertIndex = i + 1
    }

    this.middlewareOrder.splice(insertIndex, 0, middleware.name)

    logger.debug(`Registered middleware: ${middleware.name} (priority: ${priority})`)
  }

  /**
   * Execute middleware chain
   */
  async executeMiddlewares(context: RequestContext, middlewareNames: string[] = this.middlewareOrder): Promise<void> {
    let index = 0

    const next = async (): Promise<void> => {
      if (index >= middlewareNames.length) {
        return
      }

      const middlewareName = middlewareNames[index++]
      const middleware = this.middlewares.get(middlewareName)

      if (!middleware) {
        logger.warn(`Middleware not found: ${middlewareName}`)
        return next()
      }

      await middleware.execute(context.request, context.response, next)
    }

    await next()
  }

  /**
   * Setup default middlewares
   */
  private setupDefaultMiddlewares(): void {
    // Error handling middleware (should be first)
    this.use({
      name: 'error-handler',
      priority: 0,
      execute: async (req: DataRequest, res: DataResponse, next: () => Promise<void>) => {
        try {
          await next()
        } catch (error) {
          logger.error(`Request error: ${req.method} ${req.path}`, error as Error)

          const apiError = toDataApiError(error, `${req.method} ${req.path}`)
          res.error = apiError
          res.status = apiError.status
        }
      }
    })

    // Request logging middleware
    this.use({
      name: 'request-logger',
      priority: 10,
      execute: async (req: DataRequest, res: DataResponse, next: () => Promise<void>) => {
        const startTime = Date.now()

        logger.debug(`Incoming request: ${req.method} ${req.path}`, {
          id: req.id,
          params: req.params,
          body: req.body
        })

        await next()

        const duration = Date.now() - startTime
        res.metadata = {
          ...res.metadata,
          duration,
          timestamp: Date.now()
        }

        logger.debug(`Request completed: ${req.method} ${req.path}`, {
          id: req.id,
          status: res.status,
          duration
        })
      }
    })

    // Response formatting middleware (should be last)
    this.use({
      name: 'response-formatter',
      priority: 100,
      execute: async (_req: DataRequest, res: DataResponse, next: () => Promise<void>) => {
        await next()

        // Ensure response always has basic structure
        if (!res.status) {
          res.status = 200
        }

        if (!res.metadata) {
          res.metadata = {
            duration: 0,
            timestamp: Date.now()
          }
        }
      }
    })
  }

  /**
   * Get all middleware names in execution order
   */
  getMiddlewares(): string[] {
    return [...this.middlewareOrder]
  }

  /**
   * Get middleware by name
   */
  getMiddleware(name: string): Middleware | undefined {
    return this.middlewares.get(name)
  }

  /**
   * Remove middleware
   */
  removeMiddleware(name: string): void {
    this.middlewares.delete(name)
    const index = this.middlewareOrder.indexOf(name)
    if (index > -1) {
      this.middlewareOrder.splice(index, 1)
    }
    logger.debug(`Removed middleware: ${name}`)
  }

  /**
   * Clear all middlewares
   */
  clear(): void {
    this.middlewares.clear()
    this.middlewareOrder = []
    logger.debug('Cleared all middlewares')
  }
}
