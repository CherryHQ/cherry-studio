/**
 * Runtime-neutral approval policy for Cherry-owned MCP tools.
 *
 * This is a registry of tool entries, not parallel allow/approval name lists. Each tool declares
 * its canonical MCP identity and approval behavior once; Claude, Pi, and DSH only translate that
 * identity into their runtime-specific wire names. Arrays or sets produced by consumers are
 * derived boundary formats for the SDK/bridge and are never policy sources.
 *
 * This deliberately does not extend the AI-SDK `ToolEntry`: that adapter does not own or even see
 * every Cherry-owned tool (Assistant MCP and the other agent runtimes bypass it). Cross-runtime
 * approval is a security policy and belongs in the runtime-neutral approval layer.
 */

import { CLI_INSTALL_TOOL_NAME, CLI_LIST_TOOL_NAME, CLI_SEARCH_TOOL_NAME } from '@main/ai/mcp/servers/cherryCliTools'
import { MOVE_TO_TRASH_TOOL_NAME } from '@main/ai/tools/moveToTrash'
import { SAVE_ATTACHMENT_TOOL_NAME } from '@main/ai/tools/saveAttachment'
import {
  SESSION_CREATE_TOOL_NAME,
  SESSION_DELIVERIES_TOOL_NAME,
  SESSION_LIST_TOOL_NAME,
  SESSION_SEARCH_TOOL_NAME,
  SESSION_SEND_TOOL_NAME
} from '@shared/ai/agentSessionDelivery'
import {
  CONFIG_TOOL_NAME,
  CRON_TOOL_NAME,
  GENERATE_IMAGE_TOOL_NAME,
  KB_LIST_TOOL_NAME,
  KB_MANAGE_TOOL_NAME,
  KB_READ_TOOL_NAME,
  KB_SEARCH_TOOL_NAME,
  NOTIFY_TOOL_NAME,
  READ_FILE_TOOL_NAME,
  REPORT_ARTIFACTS_TOOL_NAME,
  TO_MARKDOWN_TOOL_NAME,
  WEB_FETCH_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME
} from '@shared/ai/builtinTools'

export type BuiltinToolApproval = 'auto' | 'required' | 'runtime'
export type BuiltinToolAvailability = 'always' | 'assistant'
export type BuiltinToolBypassApproval = 'lift' | 'enforce'

export interface BuiltinToolPolicyEntry {
  readonly serverName: string
  readonly toolName: string
  /**
   * `auto`: Cherry pre-approves the tool; `required`: every interactive call asks unless bypassed;
   * `runtime`: the runtime's ordinary permission-mode semantics decide.
   */
  readonly approval: BuiltinToolApproval
  /** Whether Full Access lifts a `required` approval. */
  readonly bypassApproval: BuiltinToolBypassApproval
  /** Assistant-only MCP servers are mounted only for the protected Assistant/Support roles. */
  readonly availability: BuiltinToolAvailability
}

function tool(
  serverName: string,
  toolName: string,
  approval: BuiltinToolApproval,
  availability: BuiltinToolAvailability = 'always',
  bypassApproval: BuiltinToolBypassApproval = 'lift'
): BuiltinToolPolicyEntry {
  return { serverName, toolName, approval, availability, bypassApproval }
}

/**
 * Every Cherry-owned MCP tool with host approval semantics. A future tool must declare one entry;
 * omitting it is fail-closed for auto-approval because every consumer selects explicit entries.
 */
const BUILTIN_TOOL_POLICIES = {
  cherryWebSearch: tool('cherry-tools', WEB_SEARCH_TOOL_NAME, 'auto'),
  cherryWebFetch: tool('cherry-tools', WEB_FETCH_TOOL_NAME, 'auto'),
  cherryKnowledgeSearch: tool('cherry-tools', KB_SEARCH_TOOL_NAME, 'auto'),
  cherryKnowledgeRead: tool('cherry-tools', KB_READ_TOOL_NAME, 'auto'),
  cherryKnowledgeList: tool('cherry-tools', KB_LIST_TOOL_NAME, 'auto'),
  cherryKnowledgeManage: tool('cherry-tools', KB_MANAGE_TOOL_NAME, 'required'),
  cherryReportArtifacts: tool('cherry-tools', REPORT_ARTIFACTS_TOOL_NAME, 'auto'),
  cherryCron: tool('cherry-tools', CRON_TOOL_NAME, 'auto'),
  cherryNotify: tool('cherry-tools', NOTIFY_TOOL_NAME, 'auto'),
  cherryConfig: tool('cherry-tools', CONFIG_TOOL_NAME, 'auto'),
  cherrySessionList: tool('cherry-tools', SESSION_LIST_TOOL_NAME, 'auto'),
  cherrySessionSearch: tool('cherry-tools', SESSION_SEARCH_TOOL_NAME, 'auto'),
  cherrySessionDeliveries: tool('cherry-tools', SESSION_DELIVERIES_TOOL_NAME, 'auto'),
  cherrySessionCreate: tool('cherry-tools', SESSION_CREATE_TOOL_NAME, 'required', 'always', 'enforce'),
  cherrySessionSend: tool('cherry-tools', SESSION_SEND_TOOL_NAME, 'required', 'always', 'enforce'),
  cherryCliList: tool('cherry-tools', CLI_LIST_TOOL_NAME, 'auto'),
  cherryCliSearch: tool('cherry-tools', CLI_SEARCH_TOOL_NAME, 'auto'),
  cherryCliInstall: tool('cherry-tools', CLI_INSTALL_TOOL_NAME, 'required'),
  cherryToMarkdown: tool('cherry-tools', TO_MARKDOWN_TOOL_NAME, 'auto'),
  cherryGenerateImage: tool('cherry-tools', GENERATE_IMAGE_TOOL_NAME, 'required'),

  agentMemory: tool('agent-memory', 'memory', 'auto'),
  searchSkills: tool('skills', 'search_skills', 'auto'),
  installSkill: tool('skills', 'install_skill', 'runtime'),

  assistantNavigate: tool('assistant', 'navigate', 'auto', 'assistant'),
  assistantProductInfo: tool('assistant', 'product_info', 'auto', 'assistant'),
  assistantDiagnose: tool('assistant', 'diagnose', 'required', 'assistant'),
  assistantApplySetting: tool('assistant', 'apply_setting', 'required', 'assistant'),
  assistantCreateAgent: tool('assistant', 'create_agent', 'required', 'assistant'),
  assistantReadFile: tool('assistant-files', READ_FILE_TOOL_NAME, 'auto', 'assistant'),
  assistantMoveToTrash: tool('assistant-files', MOVE_TO_TRASH_TOOL_NAME, 'required', 'assistant'),
  assistantSaveAttachment: tool('assistant-files', SAVE_ATTACHMENT_TOOL_NAME, 'required', 'assistant')
} as const satisfies Record<string, BuiltinToolPolicyEntry>

const BUILTIN_TOOL_POLICY_ENTRIES: readonly BuiltinToolPolicyEntry[] = Object.values(BUILTIN_TOOL_POLICIES)
const BUILTIN_TOOL_POLICY_BY_RUNTIME_NAME = new Map(
  BUILTIN_TOOL_POLICY_ENTRIES.map((entry) => [toMcpRuntimeName(entry), entry])
)

export interface BuiltinToolPolicyQuery {
  readonly approval?: BuiltinToolApproval
  readonly bypassApproval?: BuiltinToolBypassApproval
  /** Omit to inspect the complete registry; false filters out Assistant-only entries. */
  readonly assistantMcpEnabled?: boolean
}

/** Query entries without exposing a mutable registry or a maintained name list. */
export function listBuiltinToolPolicies(query: BuiltinToolPolicyQuery = {}): BuiltinToolPolicyEntry[] {
  return BUILTIN_TOOL_POLICY_ENTRIES.filter(
    (entry) =>
      (query.approval === undefined || entry.approval === query.approval) &&
      (query.bypassApproval === undefined || entry.bypassApproval === query.bypassApproval) &&
      (query.assistantMcpEnabled !== false || entry.availability !== 'assistant')
  )
}

/** Resolve a Claude-style MCP runtime name against the policy active for this session. */
export function findBuiltinToolPolicy(
  runtimeName: string,
  assistantMcpEnabled: boolean
): BuiltinToolPolicyEntry | undefined {
  const entry = BUILTIN_TOOL_POLICY_BY_RUNTIME_NAME.get(runtimeName)
  if (entry?.availability === 'assistant' && !assistantMcpEnabled) return undefined
  return entry
}

/** Standard MCP runtime name used by Claude Code and by safe DSH bridged identities. */
export function toMcpRuntimeName(ref: Pick<BuiltinToolPolicyEntry, 'serverName' | 'toolName'>): string {
  return `mcp__${ref.serverName}__${ref.toolName}`
}

/** Convenience for the non-policy citation call site. */
export function toCherryBuiltinRuntimeName(toolName: string): string {
  return toMcpRuntimeName({ serverName: 'cherry-tools', toolName })
}
