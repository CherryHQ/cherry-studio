import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'

import { PromptBuilder } from '@main/ai/agents/prompt'

export function createPiIdentityExtension(agentDataPath: string): ExtensionFactory {
  const builder = new PromptBuilder()
  return (pi) => {
    pi.on('before_agent_start', async (event) => {
      const { text, resources } = await builder.buildMemoriesContext(agentDataPath)
      event.systemPromptOptions.sections.agent_identity = text
      event.systemPromptOptions.sectionSources ??= {}
      event.systemPromptOptions.sectionSources.agent_identity = { kind: 'memory-files', resources }
    })
  }
}
