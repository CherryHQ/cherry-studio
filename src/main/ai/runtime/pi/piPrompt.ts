import { resolveAgentCapabilities, resolveAgentMcpToolExposure } from '@main/ai/agents/builtin/builtinAgentCapabilities'
import { buildAgentPrompt, type BuildAgentPromptOptions } from '@main/ai/agents/prompt/buildAgentPrompt'
import type { AgentEntity } from '@shared/data/api/schemas/agents'

import { resolvePiToolCallForm } from './piToolCallForm'

export function buildPiAgentPrompt({
  agent,
  channelLinked,
  disabledTools,
  knowledgeBaseScope,
  toolSearchLoadsMcp = false,
  ...prompt
}: Pick<
  BuildAgentPromptOptions,
  'workspacePath' | 'agentDataPath' | 'effectiveLanguage' | 'modelName' | 'instructionsSlot'
> & {
  agent: BuildAgentPromptOptions['agent'] & Pick<AgentEntity, 'type'>
  channelLinked: boolean
  disabledTools: ReadonlySet<string>
  knowledgeBaseScope: readonly string[]
  toolSearchLoadsMcp?: boolean
}) {
  const { allowsTool } = resolveAgentMcpToolExposure(agent, { channelLinked })
  return buildAgentPrompt({
    ...prompt,
    agent,
    ...resolvePiToolCallForm(disabledTools, { toolSearchLoadsMcp, allowsTool }),
    includeKnowledgeCitations: resolveAgentCapabilities(agent).allKnowledgeBases || knowledgeBaseScope.length > 0
  })
}
