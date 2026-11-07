import type { AgentPermissionMode } from '../../data/api/schemas/agents'
import type { ToolApproval, ToolOrigin } from '../tool'
import { buildMcpWireToolId, buildMcpWireWildcard } from '../tools/mcpSourcePolicy'

export interface ClaudeToolDescriptor {
  id: string
  name: string
  description?: string
  origin: ToolOrigin
  sourceId?: string
  sourceName?: string
  sourceToolName?: string
  sourceApproval?: ToolApproval
}

export interface ClaudeToolDecision {
  id: string
  approval: ToolApproval
}

export interface ClaudeToolInvocation {
  toolName: string
  input?: unknown
}

export interface ClaudeToolPolicy {
  permissionMode?: AgentPermissionMode
}

const DEFAULT_SAFE_TOOLS = new Set(['Read', 'Glob', 'Grep', 'NotebookRead', 'Task', 'TodoWrite'])
const ACCEPT_EDITS_TOOLS = new Set(['Edit', 'MultiEdit', 'NotebookEdit', 'Write'])
const ACCEPT_EDITS_BASH_COMMANDS = new Set(['mkdir', 'touch', 'mv', 'cp'])

export function normalizeClaudeBuiltinName(name: string): string {
  return name.startsWith('builtin_') ? name.slice('builtin_'.length) : name
}

export function buildClaudeMcpToolName(serverName: string, toolName: string): string {
  return buildMcpWireToolId(serverName, toolName)
}

export function buildClaudeMcpWildcard(serverName: string): string {
  return buildMcpWireWildcard(serverName)
}

function rawClaudeMcpToolName(serverName: string, toolName: string): string {
  return `mcp__${serverName}__${toolName}`
}

export function matchesClaudeToolRule(rule: string, descriptor: ClaudeToolDescriptor): boolean {
  if (rule === descriptor.id) return true

  if (descriptor.origin === 'builtin') {
    return normalizeClaudeBuiltinName(rule) === normalizeClaudeBuiltinName(descriptor.id)
  }

  if (descriptor.origin === 'mcp') {
    if (descriptor.sourceName && rule === buildClaudeMcpWildcard(descriptor.sourceName)) return true
    if (descriptor.sourceName && descriptor.sourceToolName) {
      if (rule === rawClaudeMcpToolName(descriptor.sourceName, descriptor.sourceToolName)) return true
      if (rule === rawClaudeMcpToolName(descriptor.sourceName, '*')) return true
    }
  }

  return false
}

function sourceDecision(descriptor: ClaudeToolDescriptor): ClaudeToolDecision | undefined {
  if (descriptor.sourceApproval === 'prompt') {
    return { id: descriptor.id, approval: 'prompt' }
  }
  return undefined
}

export function resolveClaudeToolAccess(
  descriptor: ClaudeToolDescriptor,
  policy: ClaudeToolPolicy
): ClaudeToolDecision {
  const source = sourceDecision(descriptor)
  if (source) return source

  if (policy.permissionMode === 'bypassPermissions') {
    return { id: descriptor.id, approval: 'auto' }
  }

  if (policy.permissionMode === 'acceptEdits' && ACCEPT_EDITS_TOOLS.has(descriptor.id)) {
    return { id: descriptor.id, approval: 'auto' }
  }

  if (DEFAULT_SAFE_TOOLS.has(descriptor.id)) {
    return { id: descriptor.id, approval: 'auto' }
  }

  return { id: descriptor.id, approval: 'prompt' }
}

function commandFromInput(input: unknown): string {
  const command = (input as { command?: unknown } | null | undefined)?.command
  return typeof command === 'string' ? command.trim() : ''
}

// Shell metacharacters that chain, redirect, substitute, or background a command. Their presence
// means the Bash payload is more than a single simple command, so the first-token allowlist below
// can no longer describe what will actually run.
//
// Why this matters: the acceptEdits auto-approval is a *lexical* decision made on the first
// whitespace-delimited token, but `canUseTool` later executes the *entire, unchanged* command
// string. A command like `cp ./a ./b; <second action>` would auto-approve on the `cp` prefix yet
// still run the appended action — an approval/execution mismatch. Refusing to auto-approve any
// compound/redirected/substituted command realigns the approval decision point with the real
// execution point: only a single simple command whose verb is allowlisted may skip the prompt.
const SHELL_COMPOUND_METACHARACTERS = /[;&|\n\r`$(){}<>]/

function matchesAcceptEditsBashInvocation(descriptor: ClaudeToolDescriptor, invocation: ClaudeToolInvocation): boolean {
  if (normalizeClaudeBuiltinName(descriptor.id) !== 'Bash') return false
  const command = commandFromInput(invocation.input)
  if (!command) return false
  // Any shell control/substitution operator (`;` `&&` `||` `|` `&` `$()` backticks `(` `)` `{` `}`
  // redirections, newlines) means a second action could ride along behind the allowlisted verb.
  // Fall through to the normal prompt rather than auto-approving the whole string.
  if (SHELL_COMPOUND_METACHARACTERS.test(command)) return false
  const verb = command.split(/\s+/, 1)[0]
  return ACCEPT_EDITS_BASH_COMMANDS.has(verb)
}

export function resolveClaudeToolInvocationAccess(
  descriptor: ClaudeToolDescriptor,
  policy: ClaudeToolPolicy,
  invocation: ClaudeToolInvocation
): ClaudeToolDecision {
  const source = sourceDecision(descriptor)
  if (source) return source

  if (policy.permissionMode === 'bypassPermissions') {
    return { id: descriptor.id, approval: 'auto' }
  }

  const decision = resolveClaudeToolAccess(descriptor, policy)
  if (decision.approval !== 'prompt') return decision
  if (policy.permissionMode === 'acceptEdits' && matchesAcceptEditsBashInvocation(descriptor, invocation)) {
    return { ...decision, approval: 'auto' }
  }
  return decision
}
