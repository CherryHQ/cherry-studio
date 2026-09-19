// Cross-process renderability policy for main empty-success checks and renderer fallbacks.
// Main cannot import renderer (`chooseTool` returns React nodes and `AgentToolsType`
// lives in renderer), so tool-card recognition stays mirrored — keep in sync with:
// - `src/renderer/components/chat/messages/tools/chooseTool.tsx`
// - `src/renderer/components/chat/messages/tools/toolResponse.ts` (`getCanonicalToolName`, `resolveToolType`)
// - `src/renderer/components/chat/messages/blocks/messagePartLayouts.ts` (`isHiddenPart`, `isEmptyContentPart`)
// Canonical sources are imported wherever possible (`AGENT_RUNTIME_CAPABILITIES`,
// session-delivery names, `reportArtifactsInputSchema`, `DSH_BUILTIN_TOOLS`, pi builtins);
// only the card-name set itself is mirrored. Unifying the taxonomy (e.g. moving
// `AgentToolsType` to shared) is a broader refactor deliberately left out of this PR.
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import { SESSION_CREATE_TOOL_NAME, SESSION_SEND_TOOL_NAME } from '@shared/ai/agentSessionDelivery'
import { REPORT_ARTIFACTS_TOOL_NAME, reportArtifactsInputSchema } from '@shared/ai/builtinTools'
import { DSH_BUILTIN_TOOLS } from '@shared/ai/dshBuiltinTools'
import { PI_TOOL_CALL_TOOL_NAME, PI_TOOL_DESCRIBE_TOOL_NAME } from '@shared/ai/piBuiltinTools'
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
const CHERRY_AGENT_TRANSPORTS: ReadonlySet<string> = new Set(
  Object.values(AGENT_RUNTIME_CAPABILITIES).map((caps) => caps.transport)
)

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

// dsh runtime-native builtins the renderer renders through the standard agent
// tool-call card (see chooseTool's runtime-builtin branch). `pwsh` is dsh's
// Windows identity for `bash`; the renderer maps both, so both count here.
const DSH_RUNTIME_TOOL_NAMES: ReadonlySet<string> = new Set([...DSH_BUILTIN_TOOLS.map((tool) => tool.name), 'pwsh'])

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
    if (canonical !== trimmed) return KNOWN_RENDERABLE_TOOL_NAMES.has(canonical)
    if (trimmed === PI_TOOL_CALL_TOOL_NAME || trimmed === PI_TOOL_DESCRIBE_TOOL_NAME) return true
    if (DSH_RUNTIME_TOOL_NAMES.has(trimmed)) return true
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
    // Caller-defined (API-gateway) tools stream as `dynamic-tool` and render
    // through the generic MCP card, so any identified call counts as visible.
    if (part.type === 'dynamic-tool') return true
    return isRenderableToolName(part, candidate)
  }
  return true
}

export function hasRenderableContent(parts: CherryMessagePart[]): boolean {
  return parts.some((part) => isRenderablePart(part))
}
