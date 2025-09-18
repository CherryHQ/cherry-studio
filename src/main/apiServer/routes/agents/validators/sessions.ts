import { body, param } from 'express-validator'

export const validateSession = [
  body('name').optional().isString(),
  body('sub_agent_ids').optional().isArray(),
  body('user_goal').optional().isString(),
  body('status').optional().isIn(['idle', 'running', 'completed', 'failed', 'stopped']),
  body('external_session_id').optional().isString(),
  body('model').optional().isString(),
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

export const validateSessionUpdate = [
  body('name').optional().isString(),
  body('main_agent_id').optional().notEmpty().withMessage('Main agent ID cannot be empty'),
  body('sub_agent_ids').optional().isArray(),
  body('user_goal').optional().isString(),
  body('status').optional().isIn(['idle', 'running', 'completed', 'failed', 'stopped']),
  body('external_session_id').optional().isString(),
  body('model').optional().isString(),
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

export const validateStatusUpdate = [
  body('status')
    .notEmpty()
    .isIn(['idle', 'running', 'completed', 'failed', 'stopped'])
    .withMessage('Valid status is required')
]

export const validateSessionId = [param('sessionId').notEmpty().withMessage('Session ID is required')]
