import * as z from 'zod'

import type { CdpBrowserController } from '../controller'
import { errorResponse, successResponse } from './utils'

export const ExecuteSchema = z.object({
  code: z
    .string()
    .describe(
      'JavaScript evaluated via Chrome DevTools Runtime.evaluate. Keep it short; prefer one-line with semicolons for multiple statements.'
    ),
  timeout: z.number().default(5000).describe('Timeout in milliseconds for code execution (default: 5000ms)'),
  privateMode: z
    .boolean()
    .optional()
    .describe('If true, use private browsing mode where data is not persisted (default: false)'),
  tabId: z.string().optional().describe('Tab identifier; if not provided, uses active tab')
})

export const executeToolDefinition = {
  name: 'execute',
  description:
    'Run JavaScript in the current page via Runtime.evaluate. Prefer short, single-line snippets; use semicolons for multiple statements.',
  inputSchema: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'One-line JS to evaluate in page context'
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default 5000)'
      },
      privateMode: {
        type: 'boolean',
        description: 'If true, use private browsing mode where data is not persisted (default: false)'
      },
      tabId: {
        type: 'string',
        description: 'Tab identifier; if not provided, uses active tab'
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
    return errorResponse(error as Error)
  }
}
