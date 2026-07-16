/**
 * Tool-set assembly for one `ai-sdk` agent turn (plan D6/D7).
 *
 * Combines the workspace file tools, the bounded bash tool, the managed
 * `skill` tool (only when the agent has enabled skills — the returned
 * catalog feeds the prompt section under the same condition, honoring the
 * `buildAiSdkAgentParams` contract), and the selected MCP servers' tools.
 * Every tool is wrapped by `applyToolPolicy`, so the permission matrix and
 * disabled-tool gate read the connection's live policy at fire-time.
 */

import { AI_SDK_AGENT_BUILTIN_TOOLS } from '@shared/ai/aiSdkAgentBuiltinTools'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { Tool, ToolSet } from 'ai'

import type { AgentSkillCatalogEntry } from '../skillCatalog'
import { resolveEnabledSkillCatalog } from '../skillCatalog'
import { bashDenyReason, createBashTool } from './bashTool'
import { buildMcpToolSet } from './mcpToolSet'
import { createSkillTool } from './skillTool'
import type { AgentToolApprovalClass, AgentToolPolicy } from './toolPolicy'
import { applyToolPolicy } from './toolPolicy'
import { buildWorkspaceFileTools } from './workspaceTools'

const BUILTIN_APPROVAL = new Map<string, 'auto' | 'prompt'>(
  AI_SDK_AGENT_BUILTIN_TOOLS.map((descriptor) => [descriptor.name, descriptor.approval])
)

/**
 * Matrix class for a builtin (plan D7): catalog-`auto` tools never prompt
 * (their paths are clamped to the workspace by construction); catalog-
 * `prompt` file tools are edit-class (auto in `acceptEdits`); bash stays
 * prompt-class in `default` AND `acceptEdits`.
 */
function builtinApprovalClass(name: string): AgentToolApprovalClass {
  if (BUILTIN_APPROVAL.get(name) === 'auto') return 'auto'
  return name === 'bash' ? 'prompt' : 'edit'
}

export interface BuildAgentToolSetInput {
  agent: Pick<AgentEntity, 'id' | 'mcps'>
  workspacePath: string
  policy: AgentToolPolicy
}

export interface BuiltAgentToolSet {
  tools: ToolSet
  /** Enabled-skill metadata for the prompt; non-empty iff the `skill` tool is registered. */
  skills: AgentSkillCatalogEntry[]
}

export async function buildAgentToolSet(input: BuildAgentToolSetInput): Promise<BuiltAgentToolSet> {
  const { agent, workspacePath, policy } = input

  const builtins: Record<string, Tool> = { ...buildWorkspaceFileTools(workspacePath) }
  builtins.bash = createBashTool({ workspacePath })

  const skills = await resolveEnabledSkillCatalog(agent.id)
  if (skills.length > 0) builtins.skill = createSkillTool(agent.id)

  const tools: ToolSet = {}
  for (const [name, tool] of Object.entries(builtins)) {
    tools[name] = applyToolPolicy(name, tool, policy, {
      approvalClass: builtinApprovalClass(name),
      ...(name === 'bash' ? { denyReason: bashDenyReason } : {})
    })
  }

  // Native `mcp__…` ids never collide with the lowercase builtin names.
  for (const [name, tool] of Object.entries(await buildMcpToolSet(agent.mcps ?? []))) {
    tools[name] = applyToolPolicy(name, tool, policy, { approvalClass: 'prompt' })
  }

  return { tools, skills }
}
