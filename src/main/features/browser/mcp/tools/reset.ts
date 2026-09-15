import * as z from 'zod'

import { BrowserSessionError } from '../../session/BrowserSessionError'
import type { BrowserController } from '../browserController'
import { logger } from '../types'
import { errorResponse, successResponse } from './utils'

export const ResetSchema = z
  .object({
    privateMode: z.boolean().optional().describe('true=private window, false=normal window, omit=all windows'),
    tabId: z.string().min(1).optional().describe('Close specific tab only (requires privateMode)')
  })
  .refine((input) => input.tabId === undefined || input.privateMode !== undefined, 'privateMode is required with tabId')

export const resetToolDefinition = {
  name: 'reset',
  description:
    'Close browser windows and clear state. Call when done browsing to free resources. Omit all parameters to close everything.',
  inputSchema: ResetSchema
}

export async function handleReset(controller: BrowserController, args: unknown) {
  try {
    const { privateMode, tabId } = ResetSchema.parse(args)
    if (!controller.reset) throw new BrowserSessionError('not_allowed')
    await controller.reset(privateMode, tabId)
    return successResponse('reset')
  } catch (error) {
    logger.error('Reset failed', {
      error,
      privateMode: args && typeof args === 'object' && 'privateMode' in args ? args.privateMode : undefined
    })
    return errorResponse(error instanceof Error ? error : String(error))
  }
}
