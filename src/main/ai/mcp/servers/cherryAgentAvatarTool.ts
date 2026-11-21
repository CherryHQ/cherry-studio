import type { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod'

import { application } from '@application'
import { generateImagePromptSchema } from '@main/ai/tools/generateImageTool'
import { generateImageFromPrompt, isPaintingError, paintingModelOutput } from '@main/ai/tools/painting'
import { t } from '@main/i18n'
import { agentAvatarService } from '@main/services/AgentAvatarService'
import { AGENT_AVATAR_TOOL_DESCRIPTION, AGENT_AVATAR_TOOL_NAME } from '@shared/ai/agentAvatarTool'

const inputSchema = z.strictObject({
  action: z.enum(['generate', 'restore']),
  target_agent_id: z.string().trim().min(1).optional().describe('Exact Agent ID from agent_list. Omit for yourself.'),
  prompt: generateImagePromptSchema.optional()
})

export function registerAgentAvatarTool(server: McpServer, currentAgentId: string): void {
  server.registerTool(
    AGENT_AVATAR_TOOL_NAME,
    {
      description:
        AGENT_AVATAR_TOOL_DESCRIPTION +
        ' Leave target_agent_id unset for yourself. For another Agent, use its exact ID from agent_list and ask if the name is ambiguous. Provide a prompt only for generate.',
      inputSchema
    },
    async ({ action, target_agent_id, prompt }, ctx) => {
      const targetId = target_agent_id ?? currentAgentId
      const signal = ctx.mcpReq.signal
      signal.throwIfAborted()
      if (action === 'restore') {
        const name = await agentAvatarService.restoreBackup(targetId, signal)
        return { content: [{ type: 'text', text: t('agent.avatar_tool.restored', { name, id: targetId }) }] }
      }
      if (!prompt) {
        return { isError: true, content: [{ type: 'text', text: t('agent.avatar_tool.prompt_required') }] }
      }
      agentAvatarService.requireToolTarget(targetId)
      const images = await generateImageFromPrompt(
        { prompt, numImages: 1 },
        signal,
        undefined,
        'delete_when_unreferenced'
      )
      if (isPaintingError(images) || images.length === 0) {
        return {
          isError: true,
          content: [{ type: 'text', text: paintingModelOutput(images).value }]
        }
      }
      signal.throwIfAborted()
      const firstImage = images[0]
      const files = application.get('FileManager')
      const retained = files.retainTemporaryEntry(firstImage.id)
      try {
        const { content } = await files.read(firstImage.id, { encoding: 'binary' })
        const name = await agentAvatarService.replaceWithBackup(targetId, content, signal)
        return {
          content: [{ type: 'text', text: t('agent.avatar_tool.applied', { name, id: targetId }) }]
        }
      } finally {
        retained.dispose()
      }
    }
  )
}
