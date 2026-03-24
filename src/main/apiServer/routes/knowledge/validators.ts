import type { NextFunction, Request, Response } from 'express'
import { body, query, validationResult } from 'express-validator'
import { isString } from 'lodash'

/**
 * Handle validation errors middleware
 */
export const handleValidationErrors = (req: Request, res: Response, next: NextFunction): Response | void => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: {
        message: 'Validation failed',
        type: 'invalid_request_error',
        code: 'VALIDATION_ERROR',
        details: errors.array()
      }
    })
  }
  next()
}

/**
 * Validation rules for knowledge base search
 */
export const validateKnowledgeSearch = [
  body('query')
    .isString()
    .withMessage('query must be a string')
    .notEmpty()
    .withMessage('query is required')
    .isLength({ max: 1000 })
    .withMessage('query must be at most 1000 characters'),
  body('knowledge_base_ids')
    .optional()
    .isArray()
    .withMessage('knowledge_base_ids must be an array')
    .custom((value) => {
      if (value && !value.every((id: unknown) => isString(id))) {
        throw new Error('knowledge_base_ids must contain only strings')
      }
      return true
    }),
  body('top_n')
    .optional()
    .isInt({ min: 1, max: 20 })
    .withMessage('top_n must be an integer between 1 and 20')
]

/**
 * Validation rules for knowledge base ID parameter
 */
export const validateKnowledgeBaseId = [
  query('id')
    .optional()
    .isString()
    .withMessage('id must be a string')
]

/**
 * Validation for list query parameters
 */
export const validatePagination = [
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('limit must be an integer between 1 and 100'),
  query('offset')
    .optional()
    .isInt({ min: 0 })
    .withMessage('offset must be a non-negative integer')
]
