import { query } from 'express-validator'

export const validatePagination = [
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('offset').optional().isInt({ min: 0 }).withMessage('Offset must be non-negative'),
  query('status')
    .optional()
    .isIn(['idle', 'running', 'completed', 'failed', 'stopped'])
    .withMessage('Invalid status filter')
]
