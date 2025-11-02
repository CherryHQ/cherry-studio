import type { ApiModelsResponse } from '@types'
import { ApiModelsFilterSchema } from '@types'
import type { Request, Response } from 'express'
import express from 'express'

import { loggerService } from '../../services/LoggerService'
import { modelsService } from '../services/models'

const logger = loggerService.withContext('ApiServerModelsRoutes')

const router = express
  .Router()

  /**
   * @swagger
   * /v1/models:
   *   get:
   *     summary: List available models
   *     description: Returns a list of available AI models from all configured providers with optional filtering
   *     tags: [Models]
   *     parameters:
   *       - in: query
   *         name: providerType
   *         schema:
   *           type: string
   *           enum: [openai, openai-response, anthropic, gemini]
   *         description: Filter models by provider type
   *       - in: query
   *         name: offset
   *         schema:
   *           type: integer
   *           minimum: 0
   *           default: 0
   *         description: Pagination offset
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           minimum: 1
   *         description: Maximum number of models to return
   *     responses:
   *       200:
   *         description: List of available models
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 object:
   *                   type: string
   *                   example: list
   *                 data:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/Model'
   *                 total:
   *                   type: integer
   *                   description: Total number of models (when using pagination)
   *                 offset:
   *                   type: integer
   *                   description: Current offset (when using pagination)
   *                 limit:
   *                   type: integer
   *                   description: Current limit (when using pagination)
   *       400:
   *         description: Invalid query parameters
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       503:
   *         description: Service unavailable
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  .get('/', async (req: Request, res: Response) => {
    try {
      logger.debug('Models list request received', { query: req.query })

      // Validate query parameters using Zod schema
      const filterResult = ApiModelsFilterSchema.safeParse(req.query)

      if (!filterResult.success) {
        logger.warn('Invalid model query parameters', { issues: filterResult.error.issues })
        return res.status(400).json({
          error: {
            message: 'Invalid query parameters',
            type: 'invalid_request_error',
            code: 'invalid_parameters',
            details: filterResult.error.issues.map((issue) => ({
              field: issue.path.join('.'),
              message: issue.message
            }))
          }
        })
      }

      const filter = filterResult.data
      const response = await modelsService.getModels(filter)

      if (response.data.length === 0) {
        logger.warn('No models available from providers', { filter })
      }

      logger.info('Models response ready', {
        filter,
        total: response.total,
        modelIds: response.data.map((m) => m.id)
      })

      return res.json(response satisfies ApiModelsResponse)
    } catch (error: any) {
      logger.error('Error fetching models', { error })
      return res.status(503).json({
        error: {
          message: 'Failed to retrieve models from available providers',
          type: 'service_unavailable',
          code: 'models_unavailable'
        }
      })
    }
  })

export { router as modelsRoutes }
