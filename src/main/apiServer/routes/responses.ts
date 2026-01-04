import type OpenAI from '@cherrystudio/openai'
import { isOpenAIProvider } from '@shared/utils/provider'
import type { Provider } from '@types'
import type { Request, Response } from 'express'
import express from 'express'

import { loggerService } from '../../services/LoggerService'
import type { ResponsesCreateParams } from '../adapters'
import { processMessage } from '../services/ProxyStreamService'
import { responsesService } from '../services/responses'
import { isModelOpenAIResponsesCompatible, validateModelId } from '../utils'

// Use SDK namespace types
type ResponseCreateParams = OpenAI.Responses.ResponseCreateParams

const logger = loggerService.withContext('ApiServerResponsesRoutes')

const router = express.Router()

/**
 * Check if provider+model should use direct OpenAI Responses API SDK
 *
 * A provider+model combination is considered "OpenAI Responses-compatible" if:
 * 1. It's a native OpenAI Responses provider (type === 'openai-response'), OR
 * 2. For aggregated providers (new-api/cherryin), the model has endpoint_type === 'openai-response'
 *
 * For these combinations, we bypass AI SDK conversion and use direct passthrough.
 */
function shouldUseDirectOpenAIResponses(provider: Provider, modelId: string): boolean {
  // Native OpenAI Responses provider - always use direct SDK
  if (isOpenAIProvider(provider)) {
    return true
  }

  // Check model-level compatibility for aggregated providers
  return isModelOpenAIResponsesCompatible(provider, modelId)
}

interface HandleResponseProcessingOptions {
  res: Response
  provider: Provider
  request: ResponseCreateParams
  modelId?: string
}

/**
 * Handle response processing using direct OpenAI SDK
 * Used for native OpenAI providers - bypasses AI SDK conversion
 */
async function handleDirectOpenAIResponsesProcessing({
  res,
  provider,
  request,
  modelId
}: HandleResponseProcessingOptions): Promise<void> {
  // modelId is guaranteed to be set by caller after validation
  const actualModelId = modelId!

  logger.info('Processing response via direct OpenAI SDK', {
    providerId: provider.id,
    providerType: provider.type,
    modelId: actualModelId,
    stream: !!request.stream
  })

  try {
    const validation = responsesService.validateRequest(request)
    if (!validation.isValid) {
      res.status(400).json({
        error: {
          message: validation.errors.join('; '),
          type: 'invalid_request_error',
          code: 'validation_error'
        }
      })
      return
    }

    const { client, openaiRequest } = await responsesService.processResponse({
      provider,
      request,
      modelId: actualModelId
    })

    if (request.stream) {
      await responsesService.handleStreaming(client, openaiRequest, { response: res }, provider)
    } else {
      const response = await responsesService.handleNonStreaming(client, openaiRequest)
      res.json(response)
    }
  } catch (error: unknown) {
    logger.error('Direct OpenAI Responses processing error', { error })
    const { statusCode, errorResponse } = responsesService.transformError(error)
    res.status(statusCode).json(errorResponse)
  }
}

/**
 * Handle response processing using unified AI SDK
 * Used for non-OpenAI providers that need format conversion
 */
async function handleUnifiedProcessing({
  res,
  provider,
  request,
  modelId
}: HandleResponseProcessingOptions): Promise<void> {
  // modelId is guaranteed to be set by caller after validation
  const actualModelId = modelId!

  logger.info('Processing response via unified AI SDK', {
    providerId: provider.id,
    providerType: provider.type,
    modelId: actualModelId,
    stream: !!request.stream
  })

  try {
    await processMessage({
      response: res,
      provider,
      modelId: actualModelId,
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
    logger.error('Unified processing error', { error })
    const { statusCode, errorResponse } = responsesService.transformError(error)
    res.status(statusCode).json(errorResponse)
  }
}

/**
 * Handle response processing - routes to appropriate handler based on provider and model
 *
 * Routing logic:
 * - Native OpenAI Responses providers (type === 'openai-response'): Direct OpenAI SDK
 * - Aggregated providers with model.endpoint_type === 'openai-response': Direct OpenAI SDK
 * - Other providers/models: Unified AI SDK with Responses API conversion
 */
async function handleResponseProcessing(options: HandleResponseProcessingOptions): Promise<void> {
  const { provider, modelId } = options
  const actualModelId = modelId!

  if (shouldUseDirectOpenAIResponses(provider, actualModelId)) {
    return handleDirectOpenAIResponsesProcessing(options)
  }
  return handleUnifiedProcessing(options)
}

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
 *                 description: Model ID in format provider:model or model
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 object:
 *                   type: string
 *                   example: response
 *                 created_at:
 *                   type: integer
 *                 status:
 *                   type: string
 *                 model:
 *                   type: string
 *                 output:
 *                   type: array
 *                   items:
 *                     type: object
 *                 usage:
 *                   type: object
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
        error: {
          message: 'Request body is required',
          type: 'invalid_request_error',
          code: 'missing_body'
        }
      })
    }

    if (!request.model) {
      return res.status(400).json({
        error: {
          message: 'Model is required',
          type: 'invalid_request_error',
          code: 'missing_model'
        }
      })
    }

    // Responses API uses 'input' instead of 'messages'
    if (request.input === undefined || request.input === null) {
      return res.status(400).json({
        error: {
          message: 'Input is required',
          type: 'invalid_request_error',
          code: 'missing_input'
        }
      })
    }

    logger.debug('Responses API request', {
      model: request.model,
      inputType: typeof request.input,
      stream: request.stream,
      temperature: request.temperature
    })

    // Validate model and get provider
    const modelValidation = await validateModelId(request.model)
    if (!modelValidation.valid) {
      return res.status(400).json({
        error: {
          message: modelValidation.error?.message || 'Model not found',
          type: 'invalid_request_error',
          code: modelValidation.error?.code || 'model_not_found'
        }
      })
    }

    const provider = modelValidation.provider!
    const modelId = modelValidation.modelId!

    return handleResponseProcessing({
      res,
      provider,
      request,
      modelId
    })
  } catch (error: unknown) {
    logger.error('Responses API error', { error })
    const { statusCode, errorResponse } = responsesService.transformError(error)
    return res.status(statusCode).json(errorResponse)
  }
})

export { router as responsesRoutes }
