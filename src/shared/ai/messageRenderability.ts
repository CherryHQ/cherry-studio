// Cross-process renderability policy for main empty-success checks and renderer fallbacks.
// Main cannot import renderer (`chooseTool` returns React nodes and `AgentToolsType`
// lives in renderer), so tool-card recognition stays mirrored — keep in sync with:
// - `src/renderer/components/chat/messages/tools/chooseTool.tsx`
// - `src/renderer/components/chat/messages/tools/toolResponse.ts` (`getCanonicalToolName`, `resolveToolType`)
// - `src/renderer/components/chat/messages/blocks/messagePartLayouts.ts` (`isHiddenPart`, `isEmptyContentPart`)
// Canonical sources are imported wherever possible (`AGENT_RUNTIME_CAPABILITIES`,
// session-delivery names, `reportArtifactsInputSchema`, pi builtins);
// only the card-name set itself is mirrored. Unifying the taxonomy (e.g. moving
// `AgentToolsType` to shared) is a broader refactor deliberately left out of this PR.
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import { SESSION_CREATE_TOOL_NAME, SESSION_SEND_TOOL_NAME } from '@shared/ai/agentSessionDelivery'
import { REPORT_ARTIFACTS_TOOL_NAME, reportArtifactsInputSchema } from '@shared/ai/builtinTools'
import { PI_TOOL_CALL_TOOL_NAME, PI_TOOL_DESCRIBE_TOOL_NAME, PI_TOOL_EXEC_TOOL_NAME } from '@shared/ai/piBuiltinTools'
import { parseFunctionCallToolName } from '@shared/ai/tools/mcpToolName'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { tryFileUrlToPath } from '@shared/utils/file'

import type { CherryMessagePart } from '../data/types/message'
import { readCherryMeta } from '../data/types/uiParts'

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
  // Automation REPL tools render through getAutomationReplKind
  // (renderer/components/chat/messages/tools/automation/automationRepl.ts);
  // keep in sync with the tool factory in AutomationReplTools.ts.
  'automation_repl',
  'automation_repl_reset',
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
  'report_artifacts',
  'to_markdown',
  'web_fetch',
  'web_search',
  'webSearch'
])
// NB: `read_file` (ordinary-chat attachment paging) is intentionally absent —
// the completed renderer renders no card for it, so such turns take the fallback.

// Transports stamped by a known agent runtime (mirrors the renderer's check
// in toolResponse.ts); unknown tags leave the wire name untouched there too.
const CHERRY_AGENT_TRANSPORTS: ReadonlySet<string> = new Set([
  ...Object.values(AGENT_RUNTIME_CAPABILITIES).map((caps) => caps.transport),
  // DeepSeek Harness stamps `dsh-agent` before it is a first-class runtime entry.
  'dsh-agent'
])

// Legacy static wire names DSH still emits without `cherry.tool` metadata; production
// uses `dynamic-tool` + `tool.type: 'builtin'` (non-renderable — see below).
const DSH_ORCHESTRATION_TOOL_NAMES: ReadonlySet<string> = new Set([
  'get_goal',
  'create_goal',
  'update_goal',
  'list_agents'
])

const CHERRY_RUNTIME_BUILTIN_TOOL_NAMES: ReadonlySet<string> = new Set(
  Object.values(AGENT_RUNTIME_CAPABILITIES).flatMap((caps) => caps.builtinTools().map((tool) => tool.id))
)

const PI_RUNTIME_BUILTIN_TOOL_NAMES: ReadonlySet<string> = new Set(
  AGENT_RUNTIME_CAPABILITIES.pi.builtinTools().map((tool) => tool.id)
)

// Mirrors `META_TOOL_NAMES` in renderer `meta/metaToolNames.ts`.
const PI_META_TOOL_WIRE_NAMES: ReadonlySet<string> = new Set([
  'tool_search',
  'tool_inspect',
  'tool_invoke',
  'tool_exec',
  PI_TOOL_EXEC_TOOL_NAME,
  PI_TOOL_CALL_TOOL_NAME,
  PI_TOOL_DESCRIBE_TOOL_NAME
])

// Mirrors `AgentToolsType` in renderer `chooseTool.tsx` (`isAgentTool`).
const AGENT_TOOL_CARD_NAMES: ReadonlySet<string> = new Set([
  'Skill',
  'Agent',
  'Read',
  'Task',
  'TaskOutput',
  'TaskStop',
  'Bash',
  'Search',
  'Glob',
  'TodoWrite',
  'WebSearch',
  'Grep',
  'Write',
  'WebFetch',
  'Edit',
  'MultiEdit',
  'BashOutput',
  'NotebookEdit',
  'ExitPlanMode',
  'AskUserQuestion',
  'ToolSearch',
  'ListMcpResources',
  'ReadMcpResource',
  'TaskCreate',
  'TaskGet',
  'TaskUpdate',
  'TaskList',
  'SendMessage',
  'TeamCreate',
  'TeamDelete',
  'EnterWorktree',
  'ExitWorktree',
  'Workflow'
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
  const transport = (cherry as Record<string, unknown>).transport
  return typeof transport === 'string' && CHERRY_AGENT_TRANSPORTS.has(transport)
}

function isDshAgentTransport(part: CherryMessagePart): boolean {
  const metadata = (part as unknown as { callProviderMetadata?: unknown }).callProviderMetadata
  if (typeof metadata !== 'object' || metadata === null) return false
  const cherry = (metadata as Record<string, unknown>).cherry
  if (typeof cherry !== 'object' || cherry === null) return false
  return (cherry as Record<string, unknown>).transport === 'dsh-agent'
}

function hasProviderMetadata(part: CherryMessagePart, provider: string): boolean {
  const metadata = (part as unknown as { callProviderMetadata?: unknown }).callProviderMetadata
  return typeof metadata === 'object' && metadata !== null && provider in (metadata as Record<string, unknown>)
}

function readCherryToolMetadata(part: CherryMessagePart): {
  type?: string
  serverId?: string
} {
  const metadata = (part as unknown as { callProviderMetadata?: unknown }).callProviderMetadata
  if (typeof metadata !== 'object' || metadata === null) return {}
  const cherry = (metadata as Record<string, unknown>).cherry
  if (typeof cherry !== 'object' || cherry === null) return {}
  const tool = (cherry as Record<string, unknown>).tool
  if (typeof tool !== 'object' || tool === null) return {}
  const record = tool as Record<string, unknown>
  return {
    type: typeof record.type === 'string' ? record.type : undefined,
    serverId: typeof record.serverId === 'string' ? record.serverId : undefined
  }
}

function isAgentToolCardName(name: string): boolean {
  return AGENT_TOOL_CARD_NAMES.has(name) || name.startsWith('mcp__')
}

function getCanonicalWireToolName(part: CherryMessagePart, wireName: string): string {
  if (!hasCherryTransport(part)) return wireName
  return CHERRY_RUNTIME_TOOL_RENDER_NAMES.get(wireName) ?? wireName
}

// Mirrors `resolveToolType` in renderer `toolResponse.ts` for visibility decisions.
function resolveToolVisibilityType(
  part: CherryMessagePart,
  wireName: string,
  canonicalName: string
): 'mcp' | 'provider' | 'builtin' {
  if (PI_META_TOOL_WIRE_NAMES.has(wireName) && hasCherryTransport(part)) return 'builtin'
  if (isAgentToolCardName(canonicalName) && hasCherryTransport(part)) return 'provider'
  if (PI_RUNTIME_BUILTIN_TOOL_NAMES.has(wireName) && hasCherryTransport(part)) return 'provider'
  if ((wireName === PI_TOOL_CALL_TOOL_NAME || wireName === PI_TOOL_DESCRIBE_TOOL_NAME) && hasCherryTransport(part)) {
    return 'provider'
  }
  const cherryTool = readCherryToolMetadata(part)
  if (cherryTool.type === 'mcp' || cherryTool.type === 'provider' || cherryTool.type === 'builtin') {
    return cherryTool.type
  }
  if (parseFunctionCallToolName(wireName) || parseFunctionCallToolName(canonicalName)) return 'mcp'
  if ('providerExecuted' in part && (part as { providerExecuted?: boolean }).providerExecuted) return 'provider'
  if (hasProviderMetadata(part, 'claude-code')) return 'provider'
  if (hasCherryTransport(part)) return 'provider'
  if (part.type === 'dynamic-tool' && isAgentToolCardName(canonicalName)) return 'provider'
  if (part.type === 'dynamic-tool') return 'mcp'
  if (wireName.startsWith('builtin_')) return 'builtin'
  return 'builtin'
}

function isRenderableDynamicTool(part: CherryMessagePart, wireName: string): boolean {
  const canonical = getCanonicalWireToolName(part, wireName)
  const toolType = resolveToolVisibilityType(part, wireName, canonical)
  if (toolType === 'builtin') {
    if (PI_META_TOOL_WIRE_NAMES.has(wireName) && hasCherryTransport(part)) return true
    if (PI_RUNTIME_BUILTIN_TOOL_NAMES.has(wireName) && hasCherryTransport(part)) return true
    if (wireName === 'codemode' || wireName === 'vcc_recall') {
      return hasCherryTransport(part)
    }
    return false
  }
  if (toolType === 'mcp') {
    const serverId = readCherryToolMetadata(part).serverId
    if (serverId === 'cherry-tools' || serverId === 'agent-memory') {
      return isRenderableToolName(part, canonical)
    }
    return true
  }
  return isRenderableToolName(part, canonical)
}

// Mirrors the completed renderer's file contract: `isPotentiallyVisibleEntry`
// requires a URL while the `file` render case needs a handle
// (`fileHandleFromPart`), so a non-image file counts only when it has both —
// a cherry `fileEntryId` with its stored URL, or a `file://` URL decoding to
// an absolute path. Entry-only or remote-URL parts render nothing.
function isAddressableFilePart(part: CherryMessagePart): boolean {
  if (part.type !== 'file') return false
  const url = (part as unknown as { url?: string }).url?.trim()
  if (!url) return false
  if (readCherryMeta(part)?.fileEntryId) return true
  const path = tryFileUrlToPath(url)
  return path !== undefined && AbsoluteFilePathSchema.safeParse(path).success
}

function isReportArtifactsName(name: string): boolean {
  return name === REPORT_ARTIFACTS_TOOL_NAME || name.endsWith(`__${REPORT_ARTIFACTS_TOOL_NAME}`)
}

// The artifacts footer (`MessageReportArtifacts`) zod-parses the call input
// and renders nothing when it is invalid, so only a valid call counts here.
function isValidReportArtifactsCall(part: CherryMessagePart): boolean {
  const input = (part as unknown as { input?: unknown }).input
  return reportArtifactsInputSchema.safeParse(input).success
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
    if (canonical !== trimmed && KNOWN_RENDERABLE_TOOL_NAMES.has(canonical)) return true
    if (PI_META_TOOL_WIRE_NAMES.has(trimmed)) return true
    if (PI_RUNTIME_BUILTIN_TOOL_NAMES.has(trimmed)) return true
    if (trimmed === PI_TOOL_CALL_TOOL_NAME || trimmed === PI_TOOL_DESCRIBE_TOOL_NAME) return true
    if (isAgentToolCardName(canonical)) return true
    if (part.type !== 'dynamic-tool' && isDshAgentTransport(part) && DSH_ORCHESTRATION_TOOL_NAMES.has(trimmed)) {
      return true
    }
    const toolType = resolveToolVisibilityType(part, trimmed, canonical)
    if (toolType === 'provider' && CHERRY_RUNTIME_BUILTIN_TOOL_NAMES.has(trimmed)) return true
  }
  return KNOWN_RENDERABLE_TOOL_NAMES.has(trimmed)
}

export function isHiddenMarkerPart(part: CherryMessagePart): boolean {
  return HIDDEN_MARKER_PART_TYPES.has(part.type)
}

function isEllipsisOnlyTextPart(part: CherryMessagePart): boolean {
  if (part.type !== 'text') return false
  return /^(?:\.{3}|…)$/.test(part.text?.trim() ?? '')
}

function isIgnorableEmptyTextPart(part: CherryMessagePart): boolean {
  if (part.type !== 'text' && part.type !== 'reasoning') return false
  return !part.text?.trim()
}

/** Mirrors completed `isProcessFillerText(..., holdTrailingLiveCandidate: false)` in messagePartLayouts. */
function isCompletedProcessFillerText(parts: CherryMessagePart[], position: number): boolean {
  if (!isEllipsisOnlyTextPart(parts[position])) return false
  const next = findAdjacentMeaningfulPart(parts, position, 1)
  return isProcessContentPart(next)
}

function findAdjacentMeaningfulPart(
  parts: CherryMessagePart[],
  position: number,
  direction: -1 | 1
): CherryMessagePart | undefined {
  for (let index = position + direction; index >= 0 && index < parts.length; index += direction) {
    const part = parts[index]
    if (isHiddenMarkerPart(part) || isIgnorableEmptyTextPart(part) || isEllipsisOnlyTextPart(part)) continue
    return part
  }
  return undefined
}

function isProcessContentPart(part: CherryMessagePart | undefined): boolean {
  if (!part) return false
  if (part.type === 'reasoning') return true
  return part.type === 'dynamic-tool' || part.type.startsWith('tool-')
}

export function isRenderablePart(part: CherryMessagePart): boolean {
  if (isHiddenMarkerPart(part)) return false
  if (part.type === 'text' || part.type === 'reasoning') return !!part.text?.trim()
  if (part.type === 'file') {
    const p = part as unknown as { url?: string; mediaType?: string }
    if (p.mediaType?.startsWith('image/')) return !!p.url?.trim()
    return isAddressableFilePart(part)
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
    const candidate = (part.type === 'dynamic-tool' ? (p.toolName ?? '') : part.type.slice(5)).trim()
    if (candidate && isReportArtifactsName(candidate)) return isValidReportArtifactsCall(part)
    if (part.type === 'dynamic-tool') return isRenderableDynamicTool(part, candidate)
    return isRenderableToolName(part, candidate)
  }
  return true
}

export function hasRenderableContent(parts: CherryMessagePart[]): boolean {
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]
    if (isHiddenMarkerPart(part)) continue
    if (isCompletedProcessFillerText(parts, index)) continue
    if (isRenderablePart(part)) return true
  }
  return false
}

/**
 * Deliberate ordinary-chat steer yields can end as `success` with only a
 * non-renderable tool step (e.g. `read_file`) while the follow-up is queued.
 * `AiStreamManager` preserves that boundary; Home must not synthesize a
 * no-response error for it when showing historical rows.
 */
export function isSteerHandoffEmptySuccess(parts: CherryMessagePart[]): boolean {
  if (hasRenderableContent(parts)) {
    return false
  }

  let sawNonRenderableTool = false
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]
    if (isHiddenMarkerPart(part)) continue
    if (isIgnorableEmptyTextPart(part)) continue
    if (isEllipsisOnlyTextPart(part)) continue
    if (part.type === 'text' || part.type === 'reasoning') return false
    if (part.type === 'dynamic-tool' || part.type.startsWith('tool-')) {
      if (isRenderablePart(part)) return false
      sawNonRenderableTool = true
      continue
    }
    if (isRenderablePart(part)) return false
  }
  return sawNonRenderableTool
}

/** Whether an assistant row still carries user-visible or failed-turn payload (retry eligibility). */
export function hasSubstantiveAssistantParts(parts: readonly CherryMessagePart[] | undefined): boolean {
  if (!parts || parts.length === 0) return false
  return parts.some((part) => !isHiddenMarkerPart(part))
}
