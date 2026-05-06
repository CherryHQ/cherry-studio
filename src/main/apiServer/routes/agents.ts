import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { loggerService } from '@logger'
import type { Request, Response } from 'express'
import express from 'express'

const logger = loggerService.withContext('ApiServerAgentRoutes')
const router = express.Router()

const parseOrderedIds = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null
  if (value.length === 0) return null
  if (!value.every((id) => typeof id === 'string' && id.length > 0)) return null
  return value
}

const invalidOrderedIds = (res: Response, resource: 'agent' | 'session') =>
  res.status(400).json({
    success: false,
    error: {
      message: `ordered_ids must be a non-empty array of ${resource} IDs`,
      type: 'invalid_request',
      code: 'invalid_ordered_ids'
    }
  })

router.put('/reorder', async (req: Request, res: Response) => {
  try {
    const orderedIds = parseOrderedIds(req.body?.ordered_ids)
    if (!orderedIds) return invalidOrderedIds(res, 'agent')

    await agentService.reorderAgents(orderedIds)
    logger.info('Agents reordered through legacy HTTP route', { count: orderedIds.length })
    return res.json({ success: true })
  } catch (error) {
    logger.error('Failed to reorder agents through legacy HTTP route', error as Error)
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to reorder agents', type: 'server_error', code: 'reorder_failed' }
    })
  }
})

router.put('/:agentId/sessions/reorder', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params
    const orderedIds = parseOrderedIds(req.body?.ordered_ids)
    if (!orderedIds) return invalidOrderedIds(res, 'session')

    await agentSessionService.reorderSessions(agentId, orderedIds)
    logger.info('Sessions reordered through legacy HTTP route', { agentId, count: orderedIds.length })
    return res.json({ success: true })
  } catch (error) {
    logger.error('Failed to reorder sessions through legacy HTTP route', error as Error)
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to reorder sessions', type: 'server_error', code: 'reorder_failed' }
    })
  }
})

export const agentRoutes = router
