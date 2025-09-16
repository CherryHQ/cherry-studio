import { body } from 'express-validator'

export const validateSessionMessage = [
  body('role').notEmpty().isIn(['user', 'agent', 'system', 'tool']).withMessage('Valid role is required'),
  body('content').notEmpty().isString().withMessage('Content must be a valid string')
]
