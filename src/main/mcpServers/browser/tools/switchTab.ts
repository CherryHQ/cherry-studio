import { z } from 'zod'
import type { CdpBrowserController } from '../controller'

export const SwitchTabSchema = z.object({
  sessionId: z.string().default('default').describe('Session identifier'),
  tabId: z.string().describe('Tab identifier to switch to')
})

export const switchTabToolDefinition = {
  name: 'switch_tab',
  description: 'Switch to a different tab in the session',
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
        description: 'Tab identifier to switch to'
      }
    },
    required: ['tabId']
  }
}

export async function handleSwitchTab(controller: CdpBrowserController, args: unknown) {
  const { sessionId, tabId } = SwitchTabSchema.parse(args)
  await controller.switchTab(sessionId, tabId)
  return {
    content: [{ type: 'text', text: JSON.stringify({ status: 'switched', tabId, sessionId }, null, 2) }],
    isError: false
  }
}
