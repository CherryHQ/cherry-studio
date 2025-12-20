import { z } from 'zod'
import type { CdpBrowserController } from '../controller'

export const CreateTabSchema = z.object({
  sessionId: z.string().default('default').describe('Session identifier'),
  show: z.boolean().default(false).describe('Whether to show the browser window')
})

export const createTabToolDefinition = {
  name: 'create_tab',
  description: 'Create a new browser tab in the specified session',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: 'Session identifier',
        default: 'default'
      },
      show: {
        type: 'boolean',
        description: 'Whether to show the browser window',
        default: false
      }
    }
  }
}

export async function handleCreateTab(controller: CdpBrowserController, args: unknown) {
  const { sessionId, show } = CreateTabSchema.parse(args)
  const { tabId } = await controller.createTab(sessionId, show)
  return {
    content: [{ type: 'text', text: JSON.stringify({ tabId, sessionId }, null, 2) }],
    isError: false
  }
}
