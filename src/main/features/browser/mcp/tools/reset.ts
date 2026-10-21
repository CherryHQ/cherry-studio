import { ResetSchema } from '@main/ai/mcp/browserToolDefinitions'

import { BrowserSessionError } from '../../session/BrowserSessionError'
import type { BrowserController } from '../browserController'
import { logger } from '../types'
import { errorResponse, successResponse } from './utils'

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
