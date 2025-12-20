import { z } from 'zod'
import type { CdpBrowserController } from '../controller'

export const CloseTabSchema = z.object({
  sessionId: z.string().default('default').describe('Session identifier'),
  tabId: z.string().describe('Tab identifier to close')
})

export const closeTabToolDefinition = {
  name: 'close_tab',
  description: 'Close a specific browser tab',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: 'Session identifier',
        default: 'default'
      },
      tabId: {
        type: 'string',
        description: 'Tab identifier to close'
      }
    },
    required: ['tabId']
  }
}

export async function handleCloseTab(controller: CdpBrowserController, args: unknown) {
  const { sessionId, tabId } = CloseTabSchema.parse(args)
  await controller.closeTab(sessionId, tabId)
  return {
    content: [{ type: 'text', text: JSON.stringify({ status: 'closed', tabId, sessionId }, null, 2) }],
    isError: false
  }
}
