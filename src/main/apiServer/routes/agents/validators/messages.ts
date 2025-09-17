import { body } from 'express-validator'

export const validateSessionMessage = [
  body('content').notEmpty().isString().withMessage('Content must be a valid string')
]
