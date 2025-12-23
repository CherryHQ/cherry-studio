import * as z from 'zod'

import type { CdpBrowserController } from '../controller'

export const ListTabsSchema = z.object({
  privateMode: z.boolean().default(false).describe('If true, list tabs from private browsing session (default: false)')
})

export const listTabsToolDefinition = {
  name: 'list_tabs',
  description: 'List all tabs in a browser session',
  inputSchema: {
    type: 'object',
    properties: {
      privateMode: {
        type: 'boolean',
        description: 'If true, list tabs from private browsing session (default: false)',
        default: false
      }
    }
  }
}

export async function handleListTabs(controller: CdpBrowserController, args: unknown) {
  const { privateMode } = ListTabsSchema.parse(args)
  const tabs = await controller.listTabs(privateMode)
  return {
    content: [{ type: 'text', text: JSON.stringify({ privateMode, tabs }, null, 2) }],
    isError: false
  }
}
