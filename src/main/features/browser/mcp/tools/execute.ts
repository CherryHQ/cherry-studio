import { ExecuteSchema } from '@main/ai/mcp/browserToolDefinitions'

import { BrowserSessionError } from '../../session/BrowserSessionError'
import type { BrowserController } from '../browserController'
import { logger } from '../types'
import { browserResult } from './result'
import { errorResponse, successResponse } from './utils'

export async function handleExecute(controller: BrowserController, args: unknown, signal?: AbortSignal) {
  const { code, timeout, privateMode, tabId } = ExecuteSchema.parse(args)
  let targetTabId: string | undefined
  try {
    signal?.throwIfAborted()
    targetTabId = (await controller.getSession(privateMode, tabId)).tabId
    const value = await controller.execute(code, timeout, privateMode ?? false, targetTabId, signal)
    return successResponse(typeof value === 'string' ? value : JSON.stringify(value))
  } catch (error) {
    if (error instanceof BrowserSessionError) {
      if (targetTabId === undefined) return errorResponse(error)
      return browserResult(controller, { privateMode, tabId: targetTabId }, signal, async () => {
        throw error
      })
    }
    logger.error('Execute failed', { error, code: code.slice(0, 100), privateMode, tabId })
    return errorResponse(error as Error)
  }
}
