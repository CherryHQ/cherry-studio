import * as z from 'zod'

import type { CdpBrowserController } from '../controller'

export const CloseTabSchema = z.object({
  privateMode: z.boolean().default(false).describe('If true, close tab in private browsing session (default: false)'),
  tabId: z.string().describe('Tab identifier to close')
})

export const closeTabToolDefinition = {
  name: 'close_tab',
  description: 'Close a specific browser tab',
  inputSchema: {
    type: 'object',
    properties: {
      privateMode: {
        type: 'boolean',
        description: 'If true, close tab in private browsing session (default: false)',
        default: false
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
  const { privateMode, tabId } = CloseTabSchema.parse(args)
  await controller.closeTab(privateMode, tabId)
  return {
    content: [{ type: 'text', text: JSON.stringify({ status: 'closed', tabId, privateMode }, null, 2) }],
    isError: false
  }
}
