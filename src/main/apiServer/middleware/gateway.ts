/**
 * Gateway Middleware
 *
 * Handles API Gateway features:
 * - Model group routing: /{groupName}/v1/... routes use the group's configured model
 * - Endpoint access control based on enabledEndpoints configuration
 * - Model injection for simplified external app integration
 */

import type { NextFunction, Request, Response } from 'express'

import { loggerService } from '../../services/LoggerService'
import { config } from '../config'

const logger = loggerService.withContext('GatewayMiddleware')

/**
 * Gateway middleware for model group routing
 *
 * This middleware:
 * 1. Extracts group name from URL path if present
 * 2. Looks up the group by matching name directly
 * 3. Injects the group's model into the request
 * 4. Checks if the endpoint is enabled
 */
export const gatewayMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const gatewayConfig = await config.get()
    const groupName = req.params.groupId // URL param is named groupId for backward compat

    // If groupName is provided, look up the model group by name
    if (groupName) {
      const group = gatewayConfig.modelGroups.find((g) => g.name === groupName)

      if (!group) {
        logger.warn('Model group not found', { groupName })
        res.status(404).json({
          error: {
            type: 'not_found',
            message: `Model group '${groupName}' not found`
          }
        })
        return
      }

      // Inject the group's model into the request
      req.body = {
        ...req.body,
        model: `${group.providerId}:${group.modelId}`
      }

      logger.debug('Injected model from group', {
        groupName,
        model: `${group.providerId}:${group.modelId}`
      })
    }

    // Get the endpoint path (for group routes, use the part after groupName)
    const endpoint = groupName ? req.path.replace(`/${groupName}`, '') : req.path
    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`

    // Check if endpoint is enabled (skip for /v1/models which is always enabled)
    if (!normalizedEndpoint.startsWith('/v1/models')) {
      if (!gatewayConfig.enabledEndpoints.some((e) => normalizedEndpoint.startsWith(e))) {
        res.status(404).json({
          error: {
            type: 'not_found',
            message: `Endpoint ${endpoint} is not enabled`
          }
        })
        return
      }
    }

    next()
  } catch (error) {
    next(error)
  }
}

export default gatewayMiddleware
