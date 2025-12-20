import { z } from 'zod'
import type { CdpBrowserController } from '../controller'

export const ListTabsSchema = z.object({
  sessionId: z.string().default('default').describe('Session identifier')
})

export const listTabsToolDefinition = {
  name: 'list_tabs',
  description: 'List all tabs in a browser session',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: 'Session identifier',
        default: 'default'
      }
    }
  }
}

export async function handleListTabs(controller: CdpBrowserController, args: unknown) {
  const { sessionId } = ListTabsSchema.parse(args)
  const tabs = await controller.listTabs(sessionId)
  return {
    content: [{ type: 'text', text: JSON.stringify({ sessionId, tabs }, null, 2) }],
    isError: false
  }
}
