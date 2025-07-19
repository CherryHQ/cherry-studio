import { Hono } from 'hono'

import { loggerService } from '../../services/LoggerService'
import { chatCompletionService } from '../services/ChatCompletionService'

const logger = loggerService.withContext('ApiServerModelsRoutes')

const app = new Hono()

app.get('/', async (c) => {
  try {
    logger.info('Models list request received')

    const models = await chatCompletionService.getModels()

    if (models.length === 0) {
      logger.warn('No models available from providers')
    }

    logger.info(`Returning ${models.length} models`)
    return c.json({
      object: 'list',
      data: models
    })
  } catch (error) {
    logger.error('Error fetching models:', error)
    return c.json(
      {
        error: {
          message: 'Failed to retrieve models',
          type: 'service_unavailable',
          code: 'models_unavailable'
        }
      },
      503
    )
  }
})

export { app as modelsRoutes }
