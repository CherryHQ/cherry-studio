import { Request, Response } from 'express'
import { validationResult } from 'express-validator'

import { agentService } from '../../../../services/agents'
import { loggerService } from '../../../../services/LoggerService'

const logger = loggerService.withContext('ApiServerMiddleware')

// Error handler for validation
export const handleValidationErrors = (req: Request, res: Response, next: any): void => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    res.status(400).json({
      error: {
        message: 'Validation failed',
        type: 'validation_error',
        details: errors.array()
      }
    })
    return
  }
  next()
}

// Middleware to check if agent exists
export const checkAgentExists = async (req: Request, res: Response, next: any): Promise<void> => {
  try {
    const { agentId } = req.params
    const exists = await agentService.agentExists(agentId)

    if (!exists) {
      res.status(404).json({
        error: {
          message: 'Agent not found',
          type: 'not_found',
          code: 'agent_not_found'
        }
      })
      return
    }

    next()
  } catch (error) {
    logger.error('Error checking agent existence:', error as Error)
    res.status(500).json({
      error: {
        message: 'Failed to validate agent',
        type: 'internal_error',
        code: 'agent_validation_failed'
      }
    })
  }
}
