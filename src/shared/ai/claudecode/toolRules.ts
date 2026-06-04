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
  allowedTools?: readonly string[]
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

function hasRuleMatch(values: readonly string[] | undefined, descriptor: ClaudeToolDescriptor): boolean {
  return values?.some((value) => matchesClaudeToolRule(value, descriptor)) ?? false
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

  if (hasRuleMatch(policy.allowedTools, descriptor)) {
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

function matchesAcceptEditsBashInvocation(descriptor: ClaudeToolDescriptor, invocation: ClaudeToolInvocation): boolean {
  if (normalizeClaudeBuiltinName(descriptor.id) !== 'Bash') return false
  const command = commandFromInput(invocation.input).split(/\s+/, 1)[0]
  return ACCEPT_EDITS_BASH_COMMANDS.has(command)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function matchesGlob(pattern: string, value: string): boolean {
  const source = pattern
    .split('*')
    .map((part) => escapeRegExp(part))
    .join('.*')
  return new RegExp(`^${source}$`).test(value)
}

function matchesBashInvocationRule(
  rule: string,
  descriptor: ClaudeToolDescriptor,
  invocation: ClaudeToolInvocation
): boolean {
  if (normalizeClaudeBuiltinName(descriptor.id) !== 'Bash') return false
  const match = rule.match(/^Bash\((.*)\)$/)
  if (!match) return false
  const command = commandFromInput(invocation.input)
  if (!command) return false
  return matchesGlob(match[1].trim(), command)
}

function hasInvocationRuleMatch(
  values: readonly string[] | undefined,
  descriptor: ClaudeToolDescriptor,
  invocation: ClaudeToolInvocation
): boolean {
  return values?.some((value) => matchesBashInvocationRule(value, descriptor, invocation)) ?? false
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

  if (
    hasRuleMatch(policy.allowedTools, descriptor) ||
    hasInvocationRuleMatch(policy.allowedTools, descriptor, invocation)
  ) {
    return { id: descriptor.id, approval: 'auto' }
  }

  const decision = resolveClaudeToolAccess(descriptor, policy)
  if (decision.approval !== 'prompt') return decision
  if (policy.permissionMode === 'acceptEdits' && matchesAcceptEditsBashInvocation(descriptor, invocation)) {
    return { ...decision, approval: 'auto' }
  }
  return decision
}
