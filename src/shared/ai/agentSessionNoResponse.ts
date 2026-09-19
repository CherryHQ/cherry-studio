import { getToolName, isToolUIPart } from 'ai'

import type { CherryMessagePart } from '../data/types/message'
import { fileHandleFromPart } from '../utils/file'
import { AGENT_RUNTIME_CAPABILITIES } from './agentRuntimeCapabilities'
import { SESSION_CREATE_TOOL_NAME, SESSION_SEND_TOOL_NAME } from './agentSessionDelivery'
import {
  KB_LIST_TOOL_NAME,
  KB_MANAGE_TOOL_NAME,
  KB_READ_TOOL_NAME,
  KB_SEARCH_TOOL_NAME,
  MCP_RESOURCE_LIST_TOOL_NAME,
  MCP_RESOURCE_READ_TOOL_NAME,
  PROVIDER_WEB_SEARCH_TOOL_NAME,
  REPORT_ARTIFACTS_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME
} from './builtinTools'
import { DSH_BUILTIN_TOOLS } from './dshBuiltinTools'
import { GENERATE_IMAGE_TOOL_NAME } from './generateImageTool'
import { META_TOOL_NAMES } from './metaToolNames'
import { PI_BUILTIN_TOOLS } from './piBuiltinTools'
import { RENDERED_AGENT_TOOL_NAMES } from './renderedAgentToolNames'

/**
 * Part types that never render as visible content in an agent-session turn.
 * Single source of truth for the terminal "no response" fallback: main judges
 * turn visibility at persistence time and the renderer judges it at display
 * time, so both must agree on what counts as visible.
 */
export const AGENT_SESSION_HIDDEN_PART_TYPES: ReadonlySet<string> = new Set([
  'step-start',
  'source-url',
  'source-document',
  'data-citation',
  'data-agent-task-event',
  'data-knowledge-scope',
  'data-clear'
])

/**
 * Tool names the renderer gives a card (chooseTool / MessageTools). Tools outside
 * this set render nothing, so a turn containing only them is turn-empty.
 */
const RENDERED_TOOL_NAMES: ReadonlySet<string> = new Set([
  ...Object.values(RENDERED_AGENT_TOOL_NAMES),
  ...PI_BUILTIN_TOOLS.map((tool) => tool.name),
  ...DSH_BUILTIN_TOOLS.map((tool) => tool.name),
  ...META_TOOL_NAMES,
  ...AGENT_RUNTIME_CAPABILITIES.dsh.builtinTools().map((tool) => tool.id),
  'web_fetch',
  'memory',
  KB_SEARCH_TOOL_NAME,
  KB_LIST_TOOL_NAME,
  KB_READ_TOOL_NAME,
  KB_MANAGE_TOOL_NAME,
  MCP_RESOURCE_LIST_TOOL_NAME,
  MCP_RESOURCE_READ_TOOL_NAME,
  SESSION_CREATE_TOOL_NAME,
  SESSION_SEND_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME,
  PROVIDER_WEB_SEARCH_TOOL_NAME,
  GENERATE_IMAGE_TOOL_NAME,
  REPORT_ARTIFACTS_TOOL_NAME,
  // Historical `builtin_*` wire names kept for messages already stored in DB.
  'builtin_AskUserQuestion',
  'builtin_web_search',
  'builtin_web_search_preview',
  'builtin_knowledge_search'
])

function isRenderedToolPart(part: CherryMessagePart): boolean {
  if (!isToolUIPart(part as Parameters<typeof isToolUIPart>[0])) return false
  if (part.type === 'dynamic-tool') return true
  const toolName = getToolName(part as Parameters<typeof getToolName>[0])?.trim()
  if (!toolName) return false
  return RENDERED_TOOL_NAMES.has(toolName) || toolName.startsWith('mcp__')
}

// An image file renders only with a URL; any other file only with a resolvable handle.
function isRenderedFilePart(part: CherryMessagePart): boolean {
  const filePart = part as { mediaType?: string; url?: string }
  if (filePart.mediaType?.startsWith('image/')) return !!filePart.url
  return fileHandleFromPart(part) !== undefined
}

// MessageVideo renders nothing without a URL or a local path.
function isRenderedVideoPart(part: CherryMessagePart): boolean {
  const data = (part as { data?: { url?: string; filePath?: string } }).data
  return !!data && !!(data.url || data.filePath)
}

/** True when a part can render as visible turn content. */
export function isVisibleAgentSessionPart(part: CherryMessagePart): boolean {
  if (AGENT_SESSION_HIDDEN_PART_TYPES.has(part.type)) return false
  // Retry history is visible process context, not an assistant answer.
  if (part.type === 'data-agent-api-retry') return false
  if (part.type === 'text') return !!part.text?.trim()
  // A reasoning part still streaming holds no text yet but is not terminal-empty.
  if (part.type === 'reasoning') return part.state === 'streaming' || !!part.text?.trim()
  if (part.type === 'dynamic-tool' || (typeof part.type === 'string' && part.type.startsWith('tool-'))) {
    return isRenderedToolPart(part)
  }
  // Mirror the renderer's file/video blocks, which drop unrenderable parts entirely.
  if (part.type === 'file') return isRenderedFilePart(part)
  if (part.type === 'data-video') return isRenderedVideoPart(part)
  return true
}

/** True when at least one part renders as visible turn content. */
export function hasVisibleAgentSessionPart(parts: readonly CherryMessagePart[] | undefined): boolean {
  return (parts ?? []).some(isVisibleAgentSessionPart)
}

/** Why a synthetic no-response error was authored on a terminal assistant turn. */
export type NoResponseErrorReason = 'terminal-error' | 'crash-orphan-reconcile' | 'empty-success-terminal'

export interface NoResponseErrorPartOptions {
  /** English fallback text; the renderer prefers `error.<i18nKey>` when present. */
  message: string
  /** Catalog key rendered by the error block as `error.<i18nKey>`. */
  i18nKey?: string
  reason?: NoResponseErrorReason
}

/** Synthetic `data-error` part for an assistant turn that terminated without usable content. */
export function createNoResponseErrorPart(options: NoResponseErrorPartOptions): CherryMessagePart {
  return {
    type: 'data-error',
    data: {
      name: 'AgentRuntimeError',
      message: options.message,
      stack: null,
      ...(options.i18nKey ? { i18nKey: options.i18nKey } : {}),
      ...(options.reason ? { reason: options.reason } : {})
    }
  }
}

/** Returns `data` with a no-response `data-error` part appended, unless one already exists. */
export function appendNoResponseErrorPart<T extends { parts?: CherryMessagePart[] }>(
  data: T,
  options: NoResponseErrorPartOptions
): T {
  const parts = data.parts ?? []
  if (parts.some((part) => part.type === 'data-error')) return data
  return { ...data, parts: [...parts, createNoResponseErrorPart(options)] }
}
