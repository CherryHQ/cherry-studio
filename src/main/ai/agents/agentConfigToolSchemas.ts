import * as z from 'zod'

import type { AgentConfigToolKind } from '@shared/ai/agentConfigToolKind'
import { AgentPermissionModeSchema } from '@shared/data/api/schemas/agents'

const executionToken = z.uuid().optional().describe('Internal host authorization. Omit this field.')

const settingsShape = {
  emoji: z.string().optional().describe('One emoji for the avatar.'),
  description: z.string().optional().describe('One line shown in the Agent list.'),
  instructions: z
    .string()
    .optional()
    .describe("The Agent's system prompt: role, behavior, output format. Write it in the user's language."),
  model: z.string().optional().describe('Model id in the form "providerId::modelId".'),
  permissionMode: AgentPermissionModeSchema.optional().describe(
    // Users name modes by their UI labels; Kimi K2.6 read "逐次确认" as acceptEdits without them.
    'default ("Ask Before Acting" / "逐次确认") asks before acting; acceptEdits ("Auto-accept Edits" / "自动接受编辑") accepts file edits; auto ("Approve for Me" / "智能批准") approves routine actions. bypassPermissions ("Full Access" / "完全访问") is never accepted here.'
  ),
  skillIds: z
    .array(z.string())
    .optional()
    .describe('Installed skills to enable. Replaces the current set; built-in skills keep their state.'),
  knowledgeBaseIds: z.array(z.string()).optional().describe('Knowledge bases to bind. Replaces the current set.'),
  mcpServerIds: z.array(z.string()).optional().describe('Installed MCP servers to bind. Replaces the current set.'),
  disabledTools: z
    .array(z.string())
    .optional()
    .describe('Built-in tools to switch off. Replaces the current list; an empty list enables all.'),
  language: z
    .string()
    .optional()
    .describe(
      'Reply language: "inherit" follows the global setting, "off" removes the constraint, anything else is a language label such as "English" or "中文".'
    ),
  heartbeat: z
    .strictObject({
      enabled: z.boolean().optional(),
      intervalMinutes: z.number().int().positive().optional(),
      timeoutMinutes: z.number().int().positive().optional()
    })
    .optional()
    .describe('Periodic heartbeat check.')
}

const createAgent = z.strictObject({
  ...settingsShape,
  name: z.string().trim().min(1).describe('Short display name, e.g. "Python Reviewer" or "周报助手".'),
  instructions: z
    .string()
    .trim()
    .min(1)
    .describe("The Agent's system prompt: role, behavior, output format. Write it in the user's language.")
})

const updateAgent = z.strictObject({
  agentId: z.string().min(1).describe('ID of the Agent to change, from agent_list.'),
  name: z.string().trim().min(1).optional().describe('New display name.'),
  ...settingsShape
})

/** The calling Agent's own fields; renaming stays on the approval-free `config` rename action. */
const selfUpdate = z.strictObject(settingsShape)

const createAssistant = z.strictObject({
  name: z.string().trim().min(1).describe('Short display name, e.g. "Translator" or "周报助手".'),
  emoji: settingsShape.emoji,
  description: z.string().optional().describe('One line shown in the Assistant list.'),
  prompt: z
    .string()
    .trim()
    .min(1)
    .describe("The Assistant's system prompt: role, behavior, output format. Write it in the user's language."),
  model: settingsShape.model,
  knowledgeBaseIds: z.array(z.string()).optional().describe('Knowledge bases to bind.'),
  mcpServerIds: z.array(z.string()).optional().describe('Installed MCP servers the Assistant may use.'),
  webSearch: z.boolean().optional().describe('Let the Assistant search and read the web.'),
  language: settingsShape.language
})

const executionFields = { cherryApprovalExecution: executionToken }

export const CreateAgentToolInputSchema = createAgent.extend(executionFields)
export const CreateAssistantToolInputSchema = createAssistant.extend(executionFields)
export const UpdateAgentToolInputSchema = updateAgent.extend(executionFields)
export const SelfUpdateToolInputSchema = selfUpdate.extend(executionFields)

const modelInputSchemas = {
  create_agent: createAgent,
  create_assistant: createAssistant,
  update: updateAgent,
  self_update: selfUpdate
} satisfies Record<AgentConfigToolKind, z.ZodObject>

export function formatConfigToolArguments(kind: AgentConfigToolKind): string {
  const fields = Object.entries<z.ZodType>(modelInputSchemas[kind].shape)
  const names = fields.map(([key, field]) => (field.safeParse(undefined).success ? `${key}?` : key))
  return `\`{ ${names.join(', ')} }\``
}
