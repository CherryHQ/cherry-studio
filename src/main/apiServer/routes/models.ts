import { loggerService } from '@logger'
import type { Request, Response } from 'express'
import express from 'express'

import { ApiModelsFilterSchema } from '../../../renderer/types/apiModels'
import { modelsService } from '../services/models'

const logger = loggerService.withContext('ApiServerModelsRoutes')

const router = express.Router()

/**
 * @swagger
 * /v1/models:
 *   get:
 *     summary: List available models
 *     description: List models from all enabled providers, compatible with the OpenAI API. Model IDs are returned in "providerId::modelId" format and can be passed directly to /v1/chat/completions and /v1/messages.
 *     tags: [Models]
 *     parameters:
 *       - in: query
 *         name: providerType
 *         required: false
 *         schema:
 *           type: string
 *         description: Filter to models served by providers of this type (e.g. "anthropic")
 *       - in: query
 *         name: offset
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 0
 *         description: Number of models to skip
 *       - in: query
 *         name: limit
 *         required: false
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
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         example: "my-provider::gpt-4o"
 *                       object:
 *                         type: string
 *                         example: model
 *                       created:
 *                         type: integer
 *                       owned_by:
 *                         type: string
 *                 total:
 *                   type: integer
 *                 offset:
 *                   type: integer
 *                 limit:
 *                   type: integer
 *       400:
 *         description: Bad request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/', async (req: Request, res: Response) => {
  const parsed = ApiModelsFilterSchema.safeParse(req.query)
  if (!parsed.success) {
    return res.status(400).json({
      error: {
        message: parsed.error.issues.map((issue) => issue.message).join('; '),
        type: 'invalid_request_error',
        code: 'validation_failed'
      }
    })
  }

  try {
    const response = await modelsService.getModels(parsed.data)
    return res.json(response)
  } catch (error) {
    logger.error('Error listing models', error as Error)
    return res.status(500).json({
      error: {
        message: 'Internal server error',
        type: 'server_error',
        code: 'internal_error'
      }
    })
  }
})

export { router as modelsRoutes }
