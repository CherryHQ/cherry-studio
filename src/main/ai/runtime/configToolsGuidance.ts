import type * as z from 'zod'

import {
  CreateAgentToolInputSchema,
  CreateAssistantToolInputSchema,
  SelfUpdateToolInputSchema,
  UpdateAgentToolInputSchema
} from '@main/ai/agents/agentConfigTool'
import { resolveAgentCapabilities, resolveHostTools } from '@main/ai/agents/builtin/builtinAgentCapabilities'
import { DEFAULT_ASSISTANT_TOOL_NAMES } from '@main/ai/toolApproval/assistantToolNames'
import {
  AGENT_CREATE_TOOL_NAME,
  ASSISTANT_CREATE_TOOL_NAME,
  CONFIG_UPDATE_TOOL_NAME,
  CRON_TOOL_NAME,
  REPORT_ARTIFACTS_TOOL_NAME
} from '@shared/ai/builtinTools'
import type { AgentEntity } from '@shared/data/api/schemas/agents'

/** How the model reaches a Cherry MCP tool; each runtime adapter supplies its own. */
export interface ToolCallForm {
  ref: (server: string, name: string) => string
  /** Leads with a space so a runtime without one adds nothing. */
  hint: string
}

const CREATE_REQUEST_EXAMPLES = '(for example "build me an Agent that reviews pull requests" or "建一个翻译助手")'
// Without it, models read 助手 ("assistant") as an Agent.
const RESOURCE_KINDS =
  'An Assistant (助手) is a chat persona with a prompt and a model; an Agent (智能体) works on its own with tools, skills and a workspace.'

// Kimi K2.6 answered "创建一个定时任务" with agent_create: the word "create" alone pulled it to the create tools.
const RECURRING_TASK_EXAMPLE = '每周五下午 5 点整理周报'
const CREATE_ONLY_WHEN_ASKED = (ref: ToolCallForm['ref']) =>
  `Create one only when the user explicitly asks for a new Agent or Assistant. Any other request, including a scheduled or recurring task such as "${RECURRING_TASK_EXAMPLE}", is your own work: do it yourself, and schedule it with ${ref('cherry-tools', CRON_TOOL_NAME)}.`

// Kimi K2.6 rewrote its own settings via config_update when asked for a new Agent.
const CONFIG_UPDATE_IS_SELF =
  'That tool only changes you: a request for a new Agent or Assistant always makes a new one with the create tool, never by changing your own settings.'

// Pi Durable's codemode lists no signatures; Kimi K2.6 guessed reply_language and system_prompt on every first call.
const args = (schema: z.ZodObject) =>
  `\`{ ${Object.entries(schema.shape)
    .map(([key, field]) => ((field as z.ZodType).safeParse(undefined).success ? `${key}?` : key))
    .join(', ')} }\``

const ARGS_NOTE = 'Use these exact argument names; `?` marks an optional one.'

/** The host prompt names all three, so it is only given to a session that mounts all three. */
const HOST_CONFIG_TOOLS = ['create_agent', 'create_assistant', 'update_agent'] as const

/** Without this the model describes UI steps or writes files instead of calling the tools it has. */
const hostConfigToolsPrompt = ({ ref, hint }: ToolCallForm) => `## Creating Agents and Assistants

When the user asks you to create or set up an Agent or an Assistant ${CREATE_REQUEST_EXAMPLES}, propose a configuration, then call ${ref('assistant', 'create_agent')} with ${args(CreateAgentToolInputSchema)} or ${ref('assistant', 'create_assistant')} with ${args(CreateAssistantToolInputSchema)} instead of describing UI steps or writing files. ${CREATE_ONLY_WHEN_ASKED(ref)} ${RESOURCE_KINDS} To change a user-created Agent, find it with ${ref('cherry-tools', 'agent_list')} and call ${ref('assistant', 'update_agent')} with ${args(UpdateAgentToolInputSchema)}. ${ARGS_NOTE}${hint} The user approves every call.`

const selfConfigToolsPrompt = ({
  ref,
  hint
}: ToolCallForm) => `## Creating Agents and Assistants, and changing your own settings

When the user asks you to create or set up an Agent or an Assistant ${CREATE_REQUEST_EXAMPLES}, propose a configuration, then call ${ref('cherry-tools', AGENT_CREATE_TOOL_NAME)} with ${args(CreateAgentToolInputSchema)} or ${ref('cherry-tools', ASSISTANT_CREATE_TOOL_NAME)} with ${args(CreateAssistantToolInputSchema)} instead of describing UI steps or writing files. ${CREATE_ONLY_WHEN_ASKED(ref)} ${RESOURCE_KINDS} When the user asks you to change your own avatar, description, instructions, model, permission mode, skills, knowledge bases, MCP servers, built-in tools, reply language or heartbeat, call ${ref('cherry-tools', CONFIG_UPDATE_TOOL_NAME)} with only the fields to change from ${args(SelfUpdateToolInputSchema)}. ${CONFIG_UPDATE_IS_SELF} ${ARGS_NOTE}${hint} The user approves every call.`

/** Create-tool guidance for the tools this session actually mounts; none when it mounts none. */
export function buildConfigToolsGuidance(
  agent: Pick<AgentEntity, 'configuration' | 'type'>,
  { channelLinked, callForm }: { channelLinked: boolean; callForm: ToolCallForm }
): string | undefined {
  const hostTools = resolveHostTools(agent, { channelLinked })
  if (hostTools) {
    const tools = hostTools.tools ?? DEFAULT_ASSISTANT_TOOL_NAMES
    const mountsAll = HOST_CONFIG_TOOLS.every((tool) => tools.includes(tool))
    return mountsAll ? hostConfigToolsPrompt(callForm) : undefined
  }
  return resolveAgentCapabilities(agent).createResources ? selfConfigToolsPrompt(callForm) : undefined
}

/** Without the runtime's real call form the model never finds the tool, and the Agent's Outputs stay empty. */
export function buildReportArtifactsGuidance({ ref, hint }: ToolCallForm): string {
  return `## Reporting deliverables

When you finish producing the file(s) the user asked for, call ${ref('cherry-tools', REPORT_ARTIFACTS_TOOL_NAME)} once as \`{ artifacts: [{ path, description }], summary }\`: each final file's path with a short name for it, and a one-line summary. List only the final deliverables — never intermediate, scratch, or temporary files. Skip the call entirely if the task produced no files.${hint}`
}
