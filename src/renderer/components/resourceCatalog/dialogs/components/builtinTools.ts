import { platform } from '@renderer/utils/platform'
import { AGENT_RUNTIME_CAPABILITIES, type AgentRuntimeCapabilities } from '@shared/ai/agentRuntimeCapabilities'
import { CLAUDE_KNOWLEDGE_TOOL_NAMES } from '@shared/ai/claudecode/toolRegistry'
import type { AgentType } from '@shared/data/types/agent'

const knowledgeTools = AGENT_RUNTIME_CAPABILITIES['claude-code']
  .builtinTools()
  .filter((tool) => CLAUDE_KNOWLEDGE_TOOL_NAMES.has(tool.id))

/** Settings catalog for the runtime and the agent's configured knowledge bindings. */
export function getAgentBuiltinTools(agentType: AgentType, hasKnowledgeScope: boolean) {
  const caps: AgentRuntimeCapabilities = AGENT_RUNTIME_CAPABILITIES[agentType]
  const tools = caps.builtinTools(platform)
  if (!caps.knowledgeBases) return tools
  if (!hasKnowledgeScope) return tools.filter((tool) => !CLAUDE_KNOWLEDGE_TOOL_NAMES.has(tool.id))
  return [...tools, ...knowledgeTools.filter(({ id }) => !tools.some((tool) => tool.id === id))]
}
