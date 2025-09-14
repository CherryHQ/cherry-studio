import { body, param } from 'express-validator'

export const validateAgent = [
  body('name').notEmpty().withMessage('Name is required'),
  body('model').notEmpty().withMessage('Model is required'),
  body('description').optional().isString(),
  body('avatar').optional().isString(),
  body('instructions').optional().isString(),
  body('plan_model').optional().isString(),
  body('small_model').optional().isString(),
  body('built_in_tools').optional().isArray(),
  body('mcps').optional().isArray(),
  body('knowledges').optional().isArray(),
  body('configuration').optional().isObject(),
  body('accessible_paths').optional().isArray(),
  body('permission_mode').optional().isIn(['readOnly', 'acceptEdits', 'bypassPermissions']),
  body('max_steps').optional().isInt({ min: 1 })
]

export const validateAgentUpdate = [
  body('name').optional().notEmpty().withMessage('Name cannot be empty'),
  body('model').optional().notEmpty().withMessage('Model cannot be empty'),
  body('description').optional().isString(),
  body('avatar').optional().isString(),
  body('instructions').optional().isString(),
  body('plan_model').optional().isString(),
  body('small_model').optional().isString(),
  body('built_in_tools').optional().isArray(),
  body('mcps').optional().isArray(),
  body('knowledges').optional().isArray(),
  body('configuration').optional().isObject(),
  body('accessible_paths').optional().isArray(),
  body('permission_mode').optional().isIn(['readOnly', 'acceptEdits', 'bypassPermissions']),
  body('max_steps').optional().isInt({ min: 1 })
]

export const validateAgentId = [param('agentId').notEmpty().withMessage('Agent ID is required')]
