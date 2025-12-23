import * as z from 'zod'

import type { CdpBrowserController } from '../controller'

export const CreateTabSchema = z.object({
  privateMode: z
    .boolean()
    .default(false)
    .describe('If true, create tab in private browsing mode where data is not persisted (default: false)')
})

export const createTabToolDefinition = {
  name: 'create_tab',
  description: 'Create a new browser tab',
  inputSchema: {
    type: 'object',
    properties: {
      privateMode: {
        type: 'boolean',
        description: 'If true, create tab in private browsing mode where data is not persisted (default: false)',
        default: false
      }
    }
  }
}

export async function handleCreateTab(controller: CdpBrowserController, args: unknown) {
  const parsed = CreateTabSchema.parse(args)
  const privateMode = parsed.privateMode ?? false
  const { tabId } = await controller.createTab(privateMode)
  return {
    content: [{ type: 'text', text: JSON.stringify({ tabId, privateMode }, null, 2) }],
    isError: false
  }
}
