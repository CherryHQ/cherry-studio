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
  'ToolSearch',
  'WebFetch',
  'WebSearch',
  'Workflow',
  'Write',
  'builtin_AskUserQuestion',
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

function isRenderableToolName(name: string): boolean {
  const trimmed = name.trim()
  if (!trimmed) return false
  if (trimmed.startsWith('mcp__')) return true
  if (trimmed.startsWith('builtin_')) {
    const suffix = trimmed.slice(8)
    return suffix === 'web_search' || suffix === 'web_search_preview' || suffix === 'knowledge_search'
  }
  if (trimmed === 'mcp__cherry-tools__generate_image') return true
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
    return isRenderableToolName(toolName)
  }
  return true
}

export function hasRenderableContent(parts: CherryMessagePart[]): boolean {
  return parts.some((part) => isRenderablePart(part))
}
