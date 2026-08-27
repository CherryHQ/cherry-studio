import {
  detectDestructiveAssistantCommand,
  isGitHubIssueCreationCommand,
  isLarkFormSubmissionCommand,
  isPermanentDeletionToolName,
  type PermissionCall,
  type ToolCategory
} from '@cherrystudio/agent-permission'
import { CONFIG_TOOL_NAME } from '@shared/ai/builtinTools'
import { claudeToolRequiresUserInteraction } from '@shared/ai/claudecode/toolRegistry'

import { findBuiltinToolPolicy } from './builtinToolPolicy'

const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'NotebookRead'])
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'NotebookEdit', 'Write'])
const SAFE_TOOLS = new Set(['Task', 'TodoWrite'])
const NON_BYPASSABLE_TOOLS = new Set(['mcp__cherry-tools__session_create', 'mcp__cherry-tools__session_send'])
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
  if (claudeToolRequiresUserInteraction(toolName)) return 'requires-user'
  if (NON_BYPASSABLE_TOOLS.has(toolName)) return 'non-bypassable'
  const builtin = findBuiltinToolPolicy(toolName, mountedServers)
  if (builtin?.bypassApproval === 'enforce') return 'non-bypassable'
  if (builtin?.approval === 'required') return 'sensitive-first-party'
  if (builtin?.approval === 'auto') return 'safe-first-party'
  if (READ_TOOLS.has(toolName)) return 'read'
  if (EDIT_TOOLS.has(toolName)) return 'edit'
  if (toolName === 'Bash') return 'shell'
  if (SAFE_TOOLS.has(toolName)) return 'safe-first-party'
  return 'ordinary'
}

function extractPaths(toolName: string, input: Record<string, unknown>): readonly string[] | undefined {
  const field = PATH_FIELDS[toolName]
  if (!field) return undefined
  const raw = input[field]
  if (raw === undefined || raw === null || raw === '') return ['.']
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
