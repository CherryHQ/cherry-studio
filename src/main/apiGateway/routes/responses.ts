import type OpenAI from '@cherrystudio/openai'
import { loggerService } from '@logger'
import type { Request, Response } from 'express'
import express from 'express'

import type { ResponsesCreateParams } from '../adapters'
import { processMessage } from '../services/ProxyStreamService'
import { responsesService } from '../services/responses'

// Use SDK namespace types
type ResponseCreateParams = OpenAI.Responses.ResponseCreateParams

const logger = loggerService.withContext('ApiGatewayResponsesRoutes')

const router = express.Router()

/**
 * @swagger
 * /v1/responses:
 *   post:
 *     summary: Create a response
 *     description: Create a response using OpenAI Responses API format
 *     tags: [Responses]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - model
 *               - input
 *             properties:
 *               model:
 *                 type: string
 *                 description: Model ID in format "providerId:modelId"
 *               input:
 *                 oneOf:
 *                   - type: string
 *                   - type: array
 *                     items:
 *                       type: object
 *                 description: The input to generate a response for
 *               instructions:
 *                 type: string
 *                 description: System instructions for the model
 *               stream:
 *                 type: boolean
 *                 description: Whether to stream the response
 *               max_output_tokens:
 *                 type: integer
 *                 description: Maximum number of output tokens
 *               temperature:
 *                 type: number
 *                 description: Sampling temperature
 *               tools:
 *                 type: array
 *                 description: Tools available to the model
 *     responses:
 *       200:
 *         description: Response created successfully
 *           text/event-stream:
 *             schema:
 *               type: string
 *               description: Server-sent events stream (when stream=true)
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const request = req.body as ResponseCreateParams

    if (!request) {
      return res.status(400).json({
        error: { message: 'Request body is required', type: 'invalid_request_error', code: 'missing_body' }
      })
    }

    if (!request.model) {
      return res.status(400).json({
        error: { message: 'Model is required', type: 'invalid_request_error', code: 'missing_model' }
      })
    }

    // Responses API uses 'input' instead of 'messages'.
    if (request.input === undefined || request.input === null) {
      return res.status(400).json({
        error: { message: 'Input is required', type: 'invalid_request_error', code: 'missing_input' }
      })
    }

    logger.debug('Responses API request', {
      model: request.model,
      inputType: typeof request.input,
      stream: request.stream,
      temperature: request.temperature
    })

    return await processMessage({
      response: res,
      params: request as ResponsesCreateParams,
      inputFormat: 'openai-responses',
      outputFormat: 'openai-responses',
      onError: (error) => {
        logger.error('Response error', error as Error)
      },
      onComplete: () => {
        logger.debug('Response completed')
      }
    })
  } catch (error: unknown) {
    logger.error('Responses API error', { error })
    const { statusCode, errorResponse } = responsesService.transformError(error)
    return res.status(statusCode).json(errorResponse)
  }
})

export { router as responsesRoutes }
