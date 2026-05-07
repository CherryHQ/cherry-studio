import * as z from 'zod'

import type { CdpBrowserController } from '../controller'
import { logger } from '../types'
import { errorResponse, successResponse } from './utils'

export const ResetSchema = z.object({
  privateMode: z.boolean().optional().describe('true=private window, false=normal window, omit=all windows'),
  tabId: z.string().optional().describe('Close specific tab only (requires privateMode)')
})

export const resetToolDefinition = {
  name: 'reset',
  description:
    'Close browser windows and clear state. Call when done browsing to free resources. Omit all parameters to close everything.',
  inputSchema: {
    type: 'object',
    properties: {
      privateMode: {
        type: 'boolean',
        description: 'true=reset private window only, false=reset normal window only, omit=reset all'
      },
      tabId: {
        type: 'string',
        description: 'Close specific tab only (requires privateMode to be set)'
      }
    }
  }
}

export async function handleReset(controller: CdpBrowserController, args: unknown) {
  try {
    const { privateMode, tabId } = ResetSchema.parse(args)
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
