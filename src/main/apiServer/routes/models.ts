import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import type { ApiModelsResponse } from '@types'
import { ApiModelsFilterSchema } from '@types'
import type { Request, Response } from 'express'
import express from 'express'

const logger = loggerService.withContext('ApiServerModelsRoutes')

const router = express.Router()

/**
 * @swagger
 * /v1/models:
 *   get:
 *     summary: List available models
 *     description: Returns a list of available AI models from all configured providers with optional filtering
 *     tags: [Models]
 *     parameters:
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
router.get('/', async (req: Request, res: Response) => {
  try {
    const filterResult = ApiModelsFilterSchema.safeParse(req.query)
    if (!filterResult.success) {
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

    // Get enabled providers
    const providers = await providerService.list({ enabled: true })

    // List models for all matching providers
    const allModels = (await Promise.all(providers.map((p) => modelService.list({ providerId: p.id })))).flat()

    // Transform to OpenAI-compatible format
    let data = allModels.map((model) => {
      const provider = providers.find((p) => p.id === model.providerId)
      return {
        id: model.id,
        object: 'model' as const,
        created: Math.floor(Date.now() / 1000),
        name: model.name,
        owned_by: provider?.name ?? model.providerId,
        provider: model.providerId,
        provider_name: provider?.name,
        provider_model_id: model.id
      }
    })

    const total = data.length

    // Pagination
    const offset = filter.offset ?? 0
    const limit = filter.limit
    if (limit !== undefined) {
      data = data.slice(offset, offset + limit)
    } else if (offset > 0) {
      data = data.slice(offset)
    }

    const response: ApiModelsResponse = {
      object: 'list',
      data,
      ...(filter.limit !== undefined || filter.offset !== undefined ? { total, offset } : {}),
      ...(filter.limit !== undefined ? { limit: filter.limit } : {})
    }

    return res.json(response)
  } catch (error) {
    logger.error('Error fetching models', { error })
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
