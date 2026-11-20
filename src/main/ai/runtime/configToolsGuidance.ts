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
const CREATE_ONLY_WHEN_ASKED = (ref: ToolCallForm['ref'], cron: boolean) =>
  `Create one only when the user explicitly asks for a new Agent or Assistant. Any other request is your own work: do it yourself.${cron ? ` When the user asks for a scheduled or recurring task such as "${RECURRING_TASK_EXAMPLE}", that is your own work too: schedule it with ${ref('cherry-tools', CRON_TOOL_NAME)}.` : ''}`

// Kimi K2.6 rewrote its own settings via config_update when asked for a new Agent.
const CONFIG_UPDATE_IS_SELF =
  'That tool only changes you: a request for a new Agent or Assistant always makes a new one with the create tool, never by changing your own settings.'

// Pi Durable's codemode lists no signatures; Kimi K2.6 guessed reply_language and system_prompt on every first call.
const args = (schema: z.ZodObject) =>
  `\`{ ${Object.entries(schema.shape)
    .map(([key, field]) => ((field as z.ZodType).safeParse(undefined).success ? `${key}?` : key))
    .join(', ')} }\``

const ARGS_NOTE = 'Use these exact argument names; `?` marks an optional one.'

/** Whether the session can call a Cherry MCP tool; a tool it refuses must not be named. */
type ToolEnabled = (server: string, name: string) => boolean

/** The host prompt names all three, so it is only given to a session that mounts all three. */
const HOST_CONFIG_TOOLS = ['create_agent', 'create_assistant', 'update_agent'] as const

/** The create sentence for the create tools the session can call; empty when it can call none. */
function createSentence(
  { ref }: ToolCallForm,
  enabled: ToolEnabled,
  [agentTool, assistantTool]: readonly [{ server: string; name: string }, { server: string; name: string }]
): string {
  const calls = [
    enabled(agentTool.server, agentTool.name) &&
      `${ref(agentTool.server, agentTool.name)} with ${args(CreateAgentToolInputSchema)}`,
    enabled(assistantTool.server, assistantTool.name) &&
      `${ref(assistantTool.server, assistantTool.name)} with ${args(CreateAssistantToolInputSchema)}`
  ].filter(Boolean)
  if (!calls.length) return ''
  return `When the user asks you to create or set up an Agent or an Assistant ${CREATE_REQUEST_EXAMPLES}, propose a configuration, then call ${calls.join(' or ')} instead of describing UI steps or writing files. ${CREATE_ONLY_WHEN_ASKED(ref, enabled('cherry-tools', CRON_TOOL_NAME))} ${RESOURCE_KINDS}`
}

/** Without this the model describes UI steps or writes files instead of calling the tools it has. */
function hostConfigToolsPrompt(callForm: ToolCallForm, enabled: ToolEnabled): string | undefined {
  const { ref, hint } = callForm
  const create = createSentence(callForm, enabled, [
    { server: 'assistant', name: 'create_agent' },
    { server: 'assistant', name: 'create_assistant' }
  ])
  const update =
    enabled('cherry-tools', 'agent_list') && enabled('assistant', 'update_agent')
      ? `To change a user-created Agent, find it with ${ref('cherry-tools', 'agent_list')} and call ${ref('assistant', 'update_agent')} with ${args(UpdateAgentToolInputSchema)}.`
      : ''
  if (!create && !update) return undefined
  return `## ${create ? 'Creating Agents and Assistants' : 'Changing Agents'}\n\n${[create, update].filter(Boolean).join(' ')} ${ARGS_NOTE}${hint} The user approves every call.`
}

function selfConfigToolsPrompt(callForm: ToolCallForm, enabled: ToolEnabled): string | undefined {
  const { ref, hint } = callForm
  const create = createSentence(callForm, enabled, [
    { server: 'cherry-tools', name: AGENT_CREATE_TOOL_NAME },
    { server: 'cherry-tools', name: ASSISTANT_CREATE_TOOL_NAME }
  ])
  const update = enabled('cherry-tools', CONFIG_UPDATE_TOOL_NAME)
    ? `When the user asks you to change your own avatar, description, instructions, model, permission mode, skills, knowledge bases, MCP servers, built-in tools, reply language or heartbeat, call ${ref('cherry-tools', CONFIG_UPDATE_TOOL_NAME)} with only the fields to change from ${args(SelfUpdateToolInputSchema)}.${create ? ` ${CONFIG_UPDATE_IS_SELF}` : ''}`
    : ''
  if (!create && !update) return undefined
  const title = [
    create && 'Creating Agents and Assistants',
    update && (create ? 'and changing your own settings' : 'Changing your own settings')
  ]
    .filter(Boolean)
    .join(', ')
  return `## ${title}\n\n${[create, update].filter(Boolean).join(' ')} ${ARGS_NOTE}${hint} The user approves every call.`
}

/** Create-tool guidance for the tools this session actually mounts and can call; none when it can call none. */
export function buildConfigToolsGuidance(
  agent: Pick<AgentEntity, 'configuration' | 'type'>,
  {
    channelLinked,
    callForm,
    isToolEnabled = () => true
  }: { channelLinked: boolean; callForm: ToolCallForm; isToolEnabled?: ToolEnabled }
): string | undefined {
  const hostTools = resolveHostTools(agent, { channelLinked })
  if (hostTools) {
    const tools = hostTools.tools ?? DEFAULT_ASSISTANT_TOOL_NAMES
    const mountsAll = HOST_CONFIG_TOOLS.every((tool) => tools.includes(tool))
    return mountsAll ? hostConfigToolsPrompt(callForm, isToolEnabled) : undefined
  }
  return resolveAgentCapabilities(agent).createResources ? selfConfigToolsPrompt(callForm, isToolEnabled) : undefined
}

/** Without the runtime's real call form the model never finds the tool, and the Agent's Outputs stay empty. */
export function buildReportArtifactsGuidance({ ref, hint }: ToolCallForm): string {
  return `## Reporting deliverables

When you finish producing the file(s) the user asked for, call ${ref('cherry-tools', REPORT_ARTIFACTS_TOOL_NAME)} once as \`{ artifacts: [{ path, description }], summary }\`: each final file's path with a short name for it, and a one-line summary. List only the final deliverables — never intermediate, scratch, or temporary files. Skip the call entirely if the task produced no files.${hint}`
}
