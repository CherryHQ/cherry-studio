import { body, param } from 'express-validator'

export const validateSessionMessage = [
  body('parent_id').optional().isInt({ min: 1 }).withMessage('Parent ID must be a positive integer'),
  body('role').notEmpty().isIn(['user', 'agent', 'system', 'tool']).withMessage('Valid role is required'),
  body('type').notEmpty().isString().withMessage('Type is required'),
  body('content').notEmpty().isObject().withMessage('Content must be a valid object'),
  body('metadata').optional().isObject().withMessage('Metadata must be a valid object')
]

export const validateSessionMessageUpdate = [
  body('content').optional().isObject().withMessage('Content must be a valid object'),
  body('metadata').optional().isObject().withMessage('Metadata must be a valid object')
]

export const validateBulkSessionMessages = [
  body().isArray().withMessage('Request body must be an array'),
  body('*.parent_id').optional().isInt({ min: 1 }).withMessage('Parent ID must be a positive integer'),
  body('*.role').notEmpty().isIn(['user', 'agent', 'system', 'tool']).withMessage('Valid role is required'),
  body('*.type').notEmpty().isString().withMessage('Type is required'),
  body('*.content').notEmpty().isObject().withMessage('Content must be a valid object'),
  body('*.metadata').optional().isObject().withMessage('Metadata must be a valid object')
]

export const validateMessageId = [
  param('messageId').isInt({ min: 1 }).withMessage('Message ID must be a positive integer')
]
