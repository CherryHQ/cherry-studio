import { SESSION_CREATE_TOOL_NAME, SESSION_SEND_TOOL_NAME } from '@shared/ai/agentSessionDelivery'
import { PI_TOOL_CALL_TOOL_NAME, PI_TOOL_DESCRIBE_TOOL_NAME } from '@shared/ai/piBuiltinTools'

import type { CherryMessagePart } from './types/message'

export const HIDDEN_MARKER_PART_TYPES: ReadonlySet<string> = new Set([
  'step-start',
  'source-url',
  'source-document',
  'data-citation',
  'data-agent-task-event',
  'data-knowledge-scope',
  'data-clear',
  'data-no-response-dismissed'
])

const KNOWN_RENDERABLE_TOOL_NAMES = new Set<string>([
  'Agent',
  'AskUserQuestion',
  'Bash',
  'BashOutput',
  'Edit',
  'EnterWorktree',
  'ExitPlanMode',
  'ExitWorktree',
  'Glob',
  'Grep',
  'ListMcpResources',
  'MultiEdit',
  'NotebookEdit',
  'Read',
  'ReadMcpResource',
  'Search',
  'SendMessage',
  SESSION_CREATE_TOOL_NAME,
  SESSION_SEND_TOOL_NAME,
  'Skill',
  'Task',
  'TaskCreate',
  'TaskGet',
  'TaskList',
  'TaskOutput',
  'TaskStop',
  'TaskUpdate',
  'TeamCreate',
  'TeamDelete',
  'TodoWrite',
  // Meta registry tools render through MessageMetaTool (see metaToolNames.ts).
  'tool_exec',
  'tool_inspect',
  'tool_invoke',
  'tool_search',
  'ToolSearch',
  'WebFetch',
  'WebSearch',
  'Workflow',
  'Write',
  'config',
  'cron',
  'generate_image',
  'kb_list',
  'kb_manage',
  'kb_read',
  'kb_search',
  'mcp_resource_list',
  'mcp_resource_read',
  'memory',
  'notify',
  'read_file',
  'report_artifacts',
  'to_markdown',
  'web_fetch',
  'web_search',
  'webSearch'
])

// Runtime-native wire names the cherry agent runtimes stamp onto tool parts
// (providerMetadata.cherry.transport); the renderer maps them onto the
// canonical AgentToolsType names before choosing a card (see
// getCanonicalToolName in renderer toolResponse.ts).
const CHERRY_RUNTIME_TOOL_RENDER_NAMES: ReadonlyMap<string, string> = new Map([
  ['bash', 'Bash'],
  ['pwsh', 'Bash'],
  ['edit', 'Edit'],
  ['exit_plan_mode', 'ExitPlanMode'],
  ['read', 'Read'],
  ['skill', 'Skill'],
  ['subagent', 'Task'],
  ['subagent_fork', 'Task'],
  ['todo_write', 'TodoWrite'],
  ['write', 'Write']
])

function hasCherryTransport(part: CherryMessagePart): boolean {
  const metadata = (part as unknown as { callProviderMetadata?: unknown }).callProviderMetadata
  if (typeof metadata !== 'object' || metadata === null) return false
  const cherry = (metadata as Record<string, unknown>).cherry
  if (typeof cherry !== 'object' || cherry === null) return false
  return typeof (cherry as Record<string, unknown>).transport === 'string'
}

function isRenderableToolName(part: CherryMessagePart, name: string): boolean {
  const trimmed = name.trim()
  if (!trimmed) return false
  // isAskUserQuestionToolName also accepts the historical builtin_ name.
  if (trimmed === 'AskUserQuestion' || trimmed === 'builtin_AskUserQuestion') return true
  if (trimmed.startsWith('mcp__')) return true
  if (trimmed.startsWith('builtin_')) {
    const suffix = trimmed.slice(8)
    return suffix === 'web_search' || suffix === 'web_search_preview' || suffix === 'knowledge_search'
  }
  if (hasCherryTransport(part)) {
    const canonical = CHERRY_RUNTIME_TOOL_RENDER_NAMES.get(trimmed) ?? trimmed
    if (canonical !== trimmed) return KNOWN_RENDERABLE_TOOL_NAMES.has(canonical)
    if (trimmed === PI_TOOL_CALL_TOOL_NAME || trimmed === PI_TOOL_DESCRIBE_TOOL_NAME) return true
  }
  return KNOWN_RENDERABLE_TOOL_NAMES.has(trimmed)
}

export function isHiddenMarkerPart(part: CherryMessagePart): boolean {
  return HIDDEN_MARKER_PART_TYPES.has(part.type)
}

export function isRenderablePart(part: CherryMessagePart): boolean {
  if (isHiddenMarkerPart(part)) return false
  if (part.type === 'text' || part.type === 'reasoning') return !!part.text?.trim()
  if (part.type === 'file') {
    const p = part as unknown as { url?: string }
    return !!p.url?.trim()
  }
  if (part.type === 'data-code') {
    const data = (part as unknown as { data?: { content?: string } }).data
    return !!data?.content?.trim()
  }
  if (part.type === 'data-translation') {
    const data = (part as unknown as { data?: { content?: string } }).data
    return !!data?.content?.trim()
  }
  if (part.type === 'data-compact') {
    const data = (part as unknown as { data?: { content?: string } }).data
    return !!data?.content?.trim()
  }
  if (part.type === 'data-video') {
    const data = (part as unknown as { data?: { url?: string; filePath?: string } }).data
    return !!data?.url?.trim() || !!data?.filePath?.trim()
  }
  if (part.type === 'dynamic-tool' || part.type.startsWith('tool-')) {
    const p = part as unknown as { toolCallId?: string; toolName?: string }
    if (!p.toolCallId?.trim()) return false
    const toolName = part.type.startsWith('tool-') ? part.type.slice(5) : (p.toolName ?? '')
    return isRenderableToolName(part, toolName)
  }
  return true
}

export function hasRenderableContent(parts: CherryMessagePart[]): boolean {
  return parts.some((part) => isRenderablePart(part))
}
