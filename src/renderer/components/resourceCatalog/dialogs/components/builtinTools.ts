import { platform } from '@renderer/utils/platform'
import { AGENT_RUNTIME_CAPABILITIES, type AgentRuntimeCapabilities } from '@shared/ai/agentRuntimeCapabilities'
import { CLAUDE_KNOWLEDGE_TOOL_NAMES } from '@shared/ai/claudecode/toolRegistry'
import type { AgentType } from '@shared/data/types/agent'

/**
 * The runtime's built-in tools, without browser control and computer use. The kb_* tools are only
 * injected once a knowledge base is bound, so they are left out until then.
 */
export function getAgentBuiltinTools(agentType: AgentType, hasKnowledgeScope: boolean) {
  const caps: AgentRuntimeCapabilities = AGENT_RUNTIME_CAPABILITIES[agentType]
  return caps
    .builtinTools(platform)
    .filter((tool) => !caps.knowledgeBases || hasKnowledgeScope || !CLAUDE_KNOWLEDGE_TOOL_NAMES.has(tool.id))
}
