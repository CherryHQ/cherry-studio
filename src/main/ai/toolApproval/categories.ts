import {
  detectDestructiveAssistantCommand,
  isGitHubIssueCreationCommand,
  isLarkFormSubmissionCommand,
  isPermanentDeletionToolName,
  type PermissionCall,
  type ToolCategory
} from '@cherrystudio/agent-permission'
import { CONFIG_TOOL_NAME } from '@shared/ai/builtinTools'
import { classifyClaudeToolName } from '@shared/ai/claudecode/toolRules'

import { findBuiltinToolPolicy } from './builtinToolPolicy'

const PATH_FIELDS: Record<string, string> = {
  Edit: 'file_path',
  Glob: 'path',
  Grep: 'path',
  NotebookEdit: 'notebook_path',
  NotebookRead: 'notebook_path',
  Read: 'file_path',
  Write: 'file_path'
}
const CONFIG_MUTATION_ACTIONS = new Set([
  'rename',
  'complete_bootstrap',
  'reset_bootstrap',
  'add_channel',
  'update_channel',
  'remove_channel',
  'reconnect_channel'
])

export function classifyClaudeTool(toolName: string, mountedServers: ReadonlySet<string>): ToolCategory {
  const builtin = findBuiltinToolPolicy(toolName, mountedServers)
  return classifyClaudeToolName(toolName, {
    sourceApproval: builtin?.approval === 'auto' ? 'auto' : builtin?.approval === 'required' ? 'prompt' : undefined,
    bypassApproval: builtin?.bypassApproval
  })
}

function extractPaths(toolName: string, input: Record<string, unknown>): readonly string[] | undefined {
  const field = PATH_FIELDS[toolName]
  if (!field) return undefined
  const raw = input[field]
  // Glob/Grep default to cwd when `path` is omitted. Other file tools must let the SDK reject a
  // missing or malformed path instead of accidentally authorizing the workspace root.
  if (raw === undefined || raw === null || raw === '') return toolName === 'Glob' || toolName === 'Grep' ? ['.'] : []
  // A non-string path is deliberately represented as an empty fact, which makes the evaluator ask
  // rather than treating malformed input as an omitted path.
  return typeof raw === 'string' ? [raw] : []
}

function extractConductTags(
  toolName: string,
  input: Record<string, unknown>,
  category: ToolCategory,
  builtinRole: string | undefined
): PermissionCall['conductTags'] {
  const command = typeof input.command === 'string' ? input.command : ''
  const tags: Array<NonNullable<PermissionCall['conductTags']>[number]> = []
  if (
    builtinRole &&
    ((category === 'shell' && detectDestructiveAssistantCommand(command)) || isPermanentDeletionToolName(toolName))
  ) {
    tags.push('permanent-delete')
  }
  if (
    builtinRole === 'assistant' &&
    category === 'shell' &&
    (isLarkFormSubmissionCommand(command) || isGitHubIssueCreationCommand(command))
  ) {
    tags.push('feedback-submission')
  }
  const action = typeof input.action === 'string' ? input.action : ''
  if (toolName === `mcp__cherry-tools__${CONFIG_TOOL_NAME}` && CONFIG_MUTATION_ACTIONS.has(action)) {
    tags.push('agent-config-mutation')
  }
  return tags.length > 0 ? tags : undefined
}

export function buildClaudePermissionCall(
  toolName: string,
  input: Record<string, unknown> | undefined,
  mountedServers: ReadonlySet<string>,
  builtinRole?: string
): PermissionCall {
  const normalizedInput = input ?? {}
  const category = classifyClaudeTool(toolName, mountedServers)
  return {
    toolName,
    category,
    paths: extractPaths(toolName, normalizedInput),
    command: category === 'shell' && typeof normalizedInput.command === 'string' ? normalizedInput.command : undefined,
    allowMissingTarget: category === 'edit',
    conductTags: extractConductTags(toolName, normalizedInput, category, builtinRole)
  }
}
