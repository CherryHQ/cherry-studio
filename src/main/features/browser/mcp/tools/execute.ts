import * as z from 'zod'

import { BrowserSessionError } from '../../session/BrowserSessionError'
import type { CdpBrowserController } from '../controller'
import { logger } from '../types'
import { browserResult } from './result'
import { errorResponse, successResponse } from './utils'

export const ExecuteSchema = z.object({
  code: z.string().describe('JavaScript code to run in page context'),
  timeout: z.number().default(5000).describe('Execution timeout in ms (default: 5000)'),
  privateMode: z.boolean().optional().describe('Target private session (default: false)'),
  tabId: z.string().optional().describe('Target specific tab by ID')
})

export const executeToolDefinition = {
  name: 'execute',
  description:
    'Run JavaScript in the currently open page. Use after open to: click elements, fill forms, extract content (document.body.innerText), or interact with the page. Prefer snapshot and the dedicated input tools for browser interaction. Open the page first.',
  inputSchema: ExecuteSchema
}

export async function handleExecute(controller: CdpBrowserController, args: unknown, signal?: AbortSignal) {
  const { code, timeout, privateMode, tabId } = ExecuteSchema.parse(args)
  try {
    const value = await controller.execute(code, timeout, privateMode ?? false, tabId, signal)
    return successResponse(typeof value === 'string' ? value : JSON.stringify(value))
  } catch (error) {
    if (error instanceof BrowserSessionError)
      return browserResult(controller, { privateMode, tabId }, signal, async () => {
        throw error
      })
    logger.error('Execute failed', { error, code: code.slice(0, 100), privateMode, tabId })
    return errorResponse(error as Error)
  }
}
