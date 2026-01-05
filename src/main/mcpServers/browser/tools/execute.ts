import * as z from 'zod'

import type { CdpBrowserController } from '../controller'
import { logger } from '../types'
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
    'Run JavaScript in the currently open page. Use after open to: click elements, fill forms, extract content (document.body.innerText), or interact with the page. The page must be opened first with open or fetch.',
  inputSchema: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description:
          'JavaScript to evaluate. Examples: document.body.innerText (get text), document.querySelector("button").click() (click), document.title (get title)'
      },
      timeout: {
        type: 'number',
        description: 'Execution timeout in ms (default: 5000)'
      },
      privateMode: {
        type: 'boolean',
        description: 'Target private session (default: false)'
      },
      tabId: {
        type: 'string',
        description: 'Target specific tab by ID (from open response)'
      }
    },
    required: ['code']
  }
}

export async function handleExecute(controller: CdpBrowserController, args: unknown) {
  const { code, timeout, privateMode, tabId } = ExecuteSchema.parse(args)
  try {
    const value = await controller.execute(code, timeout, privateMode ?? false, tabId)
    return successResponse(typeof value === 'string' ? value : JSON.stringify(value))
  } catch (error) {
    logger.error('Execute failed', { error, code: code.slice(0, 100), privateMode, tabId })
    return errorResponse(error as Error)
  }
}
