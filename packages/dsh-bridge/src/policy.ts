import {
  detectDestructiveAssistantCommand,
  isGitHubIssueCreationCommand,
  isLarkFormSubmissionCommand,
  isPermanentDeletionToolName,
  type PermissionContext,
  type ToolCategory
} from '@cherrystudio/agent-permission'
import { evaluatePermission, type PermissionCall } from '@cherrystudio/agent-permission/node'

import type { BridgePolicy } from './protocol'

export type ToolDecision = { kind: 'allow' } | { kind: 'deny'; reason: string } | { kind: 'ask'; reason?: string }

function asRecord(args: unknown): Record<string, unknown> {
  return typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {}
}

function categoryFor(policy: BridgePolicy, toolName: string): ToolCategory {
  if (policy.nonBypassableApprovalTools.includes(toolName)) return 'non-bypassable'
  if (policy.sensitiveTools.includes(toolName)) return 'sensitive-first-party'
  if (policy.readTools.includes(toolName)) return 'read'
  if (policy.editTools.includes(toolName)) return 'edit'
  if (policy.shellTools.includes(toolName)) return 'shell'
  if (policy.safeTools.includes(toolName)) return 'safe-first-party'
  return 'ordinary'
}

function structuredPaths(category: ToolCategory, args: unknown): readonly string[] | undefined {
  if (category !== 'read' && category !== 'edit') return undefined
  const raw = asRecord(args).file_path ?? asRecord(args).path
  if (raw === undefined || raw === null || raw === '') return ['.']
  return typeof raw === 'string' ? [raw] : []
}

function commandFor(category: ToolCategory, toolName: string, args: unknown): string | undefined {
  if (category !== 'shell' || (toolName !== 'bash' && toolName !== 'pwsh')) return undefined
  const command = asRecord(args).command
  return typeof command === 'string' ? command : undefined
}

const HEADLESS_CONFIG_MUTATION_ACTIONS = new Set([
  'rename',
  'complete_bootstrap',
  'reset_bootstrap',
  'add_channel',
  'update_channel',
  'remove_channel',
  'reconnect_channel'
])

function conductTags(
  policy: BridgePolicy,
  toolName: string,
  category: ToolCategory,
  args: unknown
): PermissionCall['conductTags'] {
  const record = asRecord(args)
  const command = typeof record.command === 'string' ? record.command : ''
  const tags: Array<NonNullable<PermissionCall['conductTags']>[number]> = []

  if (
    policy.builtinRole &&
    ((category === 'shell' && detectDestructiveAssistantCommand(command)) || isPermanentDeletionToolName(toolName))
  ) {
    tags.push('permanent-delete')
  }
  if (
    policy.builtinRole === 'assistant' &&
    category === 'shell' &&
    (isLarkFormSubmissionCommand(command) || isGitHubIssueCreationCommand(command))
  ) {
    tags.push('feedback-submission')
  }
  const action = typeof record.action === 'string' ? record.action : ''
  if ((toolName === 'config' || toolName.endsWith('__config')) && HEADLESS_CONFIG_MUTATION_ACTIONS.has(action)) {
    tags.push('agent-config-mutation')
  }
  return tags.length > 0 ? tags : undefined
}

function permissionCall(policy: BridgePolicy, toolName: string, args: unknown): PermissionCall {
  const category = categoryFor(policy, toolName)
  return {
    toolName,
    category,
    paths: structuredPaths(category, args),
    command: commandFor(category, toolName, args),
    allowMissingTarget: category === 'edit',
    conductTags: conductTags(policy, toolName, category, args)
  }
}

function contextFor(policy: BridgePolicy, delegated: boolean): PermissionContext {
  return {
    mode: policy.permissionMode,
    roots: {
      workspace: policy.allowedRoots[0] ?? '',
      agentData: policy.allowedRoots[1] ?? ''
    },
    isDisabled: (toolName) => policy.disabledTools.includes(toolName),
    responder: delegated ? 'unavailable' : policy.responder,
    turn: delegated ? 'headless' : policy.turn,
    delegated,
    builtinRole: policy.builtinRole
  }
}

function toToolDecision(decision: Awaited<ReturnType<typeof evaluatePermission>>): ToolDecision {
  if (decision.effect === 'allow') return { kind: 'allow' }
  if (decision.effect === 'deny') return { kind: 'deny', reason: decision.reason }
  return { kind: 'ask', reason: decision.reason }
}

async function evaluateTool(
  policy: BridgePolicy,
  toolName: string,
  args: unknown,
  delegated: boolean
): Promise<ToolDecision> {
  if (policy.disabledTools.includes(toolName)) {
    return { kind: 'deny', reason: `Tool "${toolName}" is disabled for this agent.` }
  }

  const call = permissionCall(policy, toolName, args)
  const context = contextFor(policy, delegated)

  if (policy.planActive) {
    if (policy.planOverlayTools.includes(toolName)) {
      return toToolDecision(await evaluatePermission({ ...call, category: 'safe-first-party' }, context))
    }
    if (policy.readTools.includes(toolName)) {
      const decision = await evaluatePermission({ ...call, category: 'read' }, context)
      if (decision.effect === 'ask') {
        return {
          kind: 'deny',
          reason: `Plan mode allows reads only inside the workspace; "${toolName}" targeted a path outside it.`
        }
      }
      return toToolDecision(decision)
    }
    return { kind: 'deny', reason: `Plan mode is read-only: "${toolName}" is unavailable until the plan is approved.` }
  }

  return toToolDecision(await evaluatePermission(call, context))
}

/** Decide one tool call under the host-pushed policy. */
export function decideToolCall(policy: BridgePolicy, toolName: string, args: unknown): Promise<ToolDecision> {
  return evaluateTool(policy, toolName, args, false)
}

/** Decide one delegated call. Any ask is converted to a deny because no child can reach a responder. */
export function decideDelegatedToolCall(policy: BridgePolicy, toolName: string, args: unknown): Promise<ToolDecision> {
  return evaluateTool(policy, toolName, args, true)
}
