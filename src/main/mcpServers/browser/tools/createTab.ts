import { z } from 'zod'
import type { CdpBrowserController } from '../controller'

export const CreateTabSchema = z.object({
  sessionId: z.string().default('default').describe('Session identifier')
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
      }
    }
  }
}

export async function handleCreateTab(controller: CdpBrowserController, args: unknown) {
  const parsed = CreateTabSchema.parse(args)
  const sessionId = parsed.sessionId ?? 'default'
  const { tabId } = await controller.createTab(sessionId)
  return {
    content: [{ type: 'text', text: JSON.stringify({ tabId, sessionId }, null, 2) }],
    isError: false
  }
}
