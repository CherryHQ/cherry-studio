import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'

import { application } from '@application'
import { PromptBuilder } from '@main/ai/agents/prompt'
import { agentMemoryReference } from '@main/ai/memory/memoryPrompt'

export function createPiIdentityExtension(agentDataPath: string, sessionId?: string): ExtensionFactory {
  const builder = new PromptBuilder()
  return (pi) => {
    pi.on('before_agent_start', async (event) => {
      event.systemPromptOptions.sections.agent_identity = await builder.buildMemoriesSection(agentDataPath)
    })
    pi.on('context_with_system', async (event, ctx) => {
      if (!sessionId) return
      const memory = await agentMemoryReference(
        sessionId,
        () => application.get('AgentSessionRuntimeService').getInteractionState(sessionId),
        ctx.signal
      )
      const messages = event.messages.map((message) => {
        if (message.role !== 'system' || !message.sections?.cherry_memory) return message
        const sections = { ...message.sections }
        delete sections.cherry_memory
        return { ...message, sections }
      })
      const index = messages.findIndex((message) => message.role === 'system')
      const system = messages[index]
      if (system?.role === 'system') {
        messages[index] = { ...system, sections: { ...system.sections, cherry_memory: memory } }
      } else {
        messages.unshift({ role: 'system', content: '', sections: { cherry_memory: memory }, timestamp: Date.now() })
      }
      return { messages }
    })
  }
}
