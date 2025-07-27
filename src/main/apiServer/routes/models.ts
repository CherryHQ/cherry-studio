import express, { Request, Response } from 'express'

import { loggerService } from '../../services/LoggerService'
import { chatCompletionService } from '../services/chat-completion'

const logger = loggerService.withContext('ApiServerModelsRoutes')

const router = express.Router()

router.get('/', async (_req: Request, res: Response) => {
  try {
    logger.info('Models list request received')

    const models = await chatCompletionService.getModels()

    if (models.length === 0) {
      logger.warn('No models available from providers')
    }

    logger.info(`Returning ${models.length} models`)
    return res.json({
      object: 'list',
      data: models
    })
  } catch (error: any) {
    logger.error('Error fetching models:', error)
    return res.status(503).json({
      error: {
        message: 'Failed to retrieve models',
        type: 'service_unavailable',
        code: 'models_unavailable'
      }
    })
  }
})

export { router as modelsRoutes }
