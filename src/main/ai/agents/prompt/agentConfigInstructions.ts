import { formatConfigToolArguments } from '@main/ai/agents/agentConfigToolSchemas'
import { CHERRY_MCP_SERVER } from '@main/ai/toolApproval/builtinToolPolicy'
import {
  AGENT_CREATE_TOOL_NAME,
  ASSISTANT_CREATE_TOOL_NAME,
  CONFIG_UPDATE_TOOL_NAME,
  CRON_TOOL_NAME
} from '@shared/ai/builtinTools'

import type { BuildAgentPromptOptions } from './buildAgentPrompt'

const TRANSLATOR_EXAMPLE = '建一个翻译助手'
const RECURRING_TASK_EXAMPLE = '每周五下午 5 点整理周报'

export function buildAgentConfigInstructions(
  referenceTool: NonNullable<BuildAgentPromptOptions['referenceTool']>,
  toolCallHint = ''
): string | undefined {
  const { ASSISTANT, CHERRY_TOOLS } = CHERRY_MCP_SERVER
  const createAgent = referenceTool(ASSISTANT, 'create_agent') ?? referenceTool(CHERRY_TOOLS, AGENT_CREATE_TOOL_NAME)
  const createAssistant =
    referenceTool(ASSISTANT, 'create_assistant') ?? referenceTool(CHERRY_TOOLS, ASSISTANT_CREATE_TOOL_NAME)
  const updateAgent = referenceTool(ASSISTANT, 'update_agent')
  const listAgents = referenceTool(CHERRY_TOOLS, 'agent_list')
  const updateSelf = referenceTool(CHERRY_TOOLS, CONFIG_UPDATE_TOOL_NAME)
  const cron = referenceTool(CHERRY_TOOLS, CRON_TOOL_NAME)

  const instructions = [
    createAgent &&
      `When the user explicitly asks for a new Agent, such as "build me an Agent that reviews pull requests", propose a configuration and call ${createAgent} with ${formatConfigToolArguments('create_agent')}.`,
    createAssistant &&
      `When the user explicitly asks for a new Assistant, such as "${TRANSLATOR_EXAMPLE}", propose a configuration and call ${createAssistant} with ${formatConfigToolArguments('create_assistant')}.`,
    (createAgent || createAssistant) &&
      'An Assistant (助手) is a chat persona with a prompt and a model. An Agent (智能体) works on its own with tools, skills and a workspace. Create a separate resource only on explicit request. Use the tool instead of describing UI steps or writing files. Carry out other work yourself.',
    (createAgent || createAssistant) &&
      cron &&
      `When the user asks for a scheduled or recurring task such as "${RECURRING_TASK_EXAMPLE}", schedule it with ${cron}.`,
    updateAgent &&
      listAgents &&
      `To change a user-created Agent, find it with ${listAgents} and call ${updateAgent} with ${formatConfigToolArguments('update')}, passing only the fields to change.`,
    updateSelf &&
      `When the user asks to change your own avatar, description, instructions, model, permission mode, skills, knowledge bases, MCP servers, built-in tools, reply language or heartbeat, call ${updateSelf} with only the fields to change from ${formatConfigToolArguments('self_update')}.`
  ].filter(Boolean)

  if (!instructions.length) return undefined
  const text = `## Creating and configuring Agents and Assistants\n\n${instructions.join('\n')}\nUse these exact argument names; \`?\` marks an optional one. The user approves each creation or settings change.`
  return toolCallHint ? `${text}\n\n${toolCallHint}` : text
}
