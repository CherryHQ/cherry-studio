import * as z from 'zod'

import type { CdpBrowserController } from '../controller'
import { successResponse } from './utils'

export const OpenSchema = z.object({
  url: z.url().describe('URL to open in the controlled Electron window'),
  timeout: z.number().optional().describe('Timeout in milliseconds for navigation (default: 10000)'),
  show: z.boolean().optional().describe('Whether to show the browser window (default: false)'),
  sessionId: z
    .string()
    .optional()
    .describe('Session identifier; separate sessions keep separate pages (default: default)')
})

export const openToolDefinition = {
  name: 'open',
  description: 'Open a URL in a hidden Electron window controlled via Chrome DevTools Protocol',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'URL to load'
      },
      timeout: {
        type: 'number',
        description: 'Navigation timeout in milliseconds (default 10000)'
      },
      show: {
        type: 'boolean',
        description: 'Whether to show the browser window (default false)'
      },
      sessionId: {
        type: 'string',
        description: 'Session identifier; separate sessions keep separate pages (default: default)'
      }
    },
    required: ['url']
  }
}

export async function handleOpen(controller: CdpBrowserController, args: unknown) {
  const { url, timeout, show, sessionId } = OpenSchema.parse(args)
  const res = await controller.open(url, timeout ?? 10000, show ?? false, sessionId ?? 'default')
  return successResponse(JSON.stringify(res))
}
