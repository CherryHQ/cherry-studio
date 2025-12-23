import * as z from 'zod'

import type { CdpBrowserController } from '../controller'

export const SwitchTabSchema = z.object({
  privateMode: z.boolean().default(false).describe('If true, switch tab in private browsing session (default: false)'),
  tabId: z.string().describe('Tab identifier to switch to')
})

export const switchTabToolDefinition = {
  name: 'switch_tab',
  description: 'Switch to a different tab in the session',
  inputSchema: {
    type: 'object',
    properties: {
      privateMode: {
        type: 'boolean',
        description: 'If true, switch tab in private browsing session (default: false)',
        default: false
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
  const { privateMode, tabId } = SwitchTabSchema.parse(args)
  await controller.switchTab(privateMode, tabId)
  return {
    content: [{ type: 'text', text: JSON.stringify({ status: 'switched', tabId, privateMode }, null, 2) }],
    isError: false
  }
}
