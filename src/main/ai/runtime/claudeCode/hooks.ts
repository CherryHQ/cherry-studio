/**
 * PreToolUse / PostToolUse hook assembly for a Claude Code session.
 *
 * Policy lives in the declarative guard table (guardRules.ts) and is enforced by ONE hook that
 * evaluates it — new policy is a table row, never a new hook. The remaining hooks are mechanical
 * (context injection, command rewrite, steer delivery, timing), kept separate so the SDK's
 * parallel fold still runs them when the guard denies.
 *
 * All hooks resolve live session state (policy snapshot, steer holder, interaction state) by
 * session id at fire-time through ClaudeCodeSessionStateService — never by closure capture — so a
 * warm-pooled query's prewarm-baked hooks observe mid-session updates.
 */

import type { HookCallback, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk'
import { application } from '@application'
import { loggerService } from '@logger'
import { wrapSteerReminder } from '@main/ai/steerReminder'
import { evaluateToolGuards } from '@main/ai/toolApproval/toolGuards'
import { rtkRewrite } from '@main/utils/rtk'

import type { AgentRuntimeUserInput } from '../types'
import type { AgentsMdLoader } from './AgentsMdLoader'
import { CLAUDE_TOOL_GUARD_RULES } from './guardRules'
import { checkSkillRuntimeDependencies, SKILL_TOOL_NAME } from './skillDependencies'
import type { ClaudeCodeSettings } from './types'

const logger = loggerService.withContext('ClaudeCodeHooks')
const EXIT_PLAN_MODE_TOOL_NAME = 'ExitPlanMode'

const sessionState = () => application.get('ClaudeCodeSessionStateService')

export function surfaceExitPlanModeInput(
  sessionId: string,
  toolName: string,
  input: Record<string, unknown> | undefined,
  toolCallId: string | undefined
): void {
  if (toolName !== EXIT_PLAN_MODE_TOOL_NAME || !toolCallId || typeof input?.plan !== 'string' || !input.plan.trim()) {
    return
  }
  sessionState().peekToolApprovalEmitter(sessionId)?.emitInput?.({ toolCallId, toolName, input })
}

function extractSteerText(input: AgentRuntimeUserInput): string {
  return (
    input.message.data?.parts
      ?.filter((part): part is { type: 'text'; text: string } => part.type === 'text' && 'text' in part)
      .map((part) => part.text)
      .join('\n') ?? ''
  )
}

export interface ClaudeCodeHookContext {
  sessionId: string
  cwd: string
  agentDataPath: string
  /** Static per-session agent facts consumed by the guard table's `appliesTo` scoping. */
  builtinRole: string | undefined
  /** Cherry-owned MCP servers mounted for this session. */
  mountedServers: ReadonlySet<string>
  /** Loaded plugin directories by manifest name; indexed once per session. */
  pluginDirectories: ReadonlyMap<string, string>
  supportsImages: boolean
  agentsMdLoader: AgentsMdLoader
}

export function buildClaudeCodeHooks(ctx: ClaudeCodeHookContext): ClaudeCodeSettings['hooks'] {
  const { sessionId, cwd, agentDataPath } = ctx

  // The single policy hook: evaluates the guard table with a fire-time context snapshot. Runs as a
  // PreToolUse hook (not in canUseTool) because hooks fire under every permission mode, while the
  // SDK skips canUseTool on auto-approved paths.
  const toolGuardHook: HookCallback = async (input, toolUseId): Promise<HookJSONOutput> => {
    if (!input || input.hook_event_name !== 'PreToolUse') return {}
    const toolName = String((input as Record<string, unknown>).tool_name ?? '')
    if (!toolName) return {}
    const toolInput = (input as Record<string, unknown>).tool_input as Record<string, unknown> | undefined
    surfaceExitPlanModeInput(sessionId, toolName, toolInput, toolUseId)
    // Live state by id at fire-time: mode and disabled-set follow mid-session agent updates on warm
    // connections; a missing snapshot means no disabled set yet (canUseTool separately fails closed).
    const snapshot = sessionState().getToolPolicySnapshot(sessionId)
    const decision = await evaluateToolGuards(CLAUDE_TOOL_GUARD_RULES, {
      toolName,
      input: toolInput,
      permissionMode: snapshot?.getPermissionMode(),
      builtinRole: ctx.builtinRole,
      mountedServers: ctx.mountedServers,
      pluginDirectories: ctx.pluginDirectories,
      cwd,
      agentDataPath,
      supportsImages: ctx.supportsImages,
      interaction: application.get('AgentSessionRuntimeService').getInteractionState(sessionId),
      isDisabled: (name) => snapshot?.isDisabled(name) ?? false
    })
    if (!decision) return {}
    if (decision.effect === 'deny') {
      logger.info('Tool guard denied a tool call', { sessionId, toolName, ruleId: decision.ruleId })
    }
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: decision.effect,
        permissionDecisionReason: decision.reason
      }
    }
  }

  // Advisory half of the skill dependency check (the blocking half is a guard rule): an unresolved
  // dependency that cannot be *proven* absent is surfaced to the model so it reports the failure
  // instead of substituting unrelated output.
  const skillDependencyAdvisoryHook: HookCallback = async (input): Promise<HookJSONOutput> => {
    if (!input || input.hook_event_name !== 'PreToolUse') return {}
    const event = input as Record<string, unknown>
    if (String(event.tool_name ?? '') !== SKILL_TOOL_NAME) return {}
    const skillName = (event.tool_input as Record<string, unknown> | undefined)?.skill
    if (typeof skillName !== 'string' || !skillName) return {}

    const { warning } = await checkSkillRuntimeDependencies(skillName, cwd, ctx.pluginDirectories)
    if (!warning) return {}
    logger.debug('Skill declares unresolved runtime dependencies', { sessionId, skillName, warning })
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: warning } }
  }

  const rtkRewriteHook: HookCallback = async (input): Promise<HookJSONOutput> => {
    if (!input || input.hook_event_name !== 'PreToolUse') return {}
    const toolName = String((input as Record<string, unknown>).tool_name ?? '')
    if (toolName !== 'Bash') return {}
    const toolInput = (input as Record<string, unknown>).tool_input as Record<string, unknown> | undefined
    const command = toolInput?.command
    if (typeof command !== 'string' || !command.trim()) return {}

    const rewritten = await rtkRewrite(command)
    if (!rewritten) return {}
    logger.info('rtk rewrote Bash command', { original: command, rewritten })
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: { ...toolInput, command: rewritten } } }
  }

  // Real mid-turn steer (the agent SDK has no native steer API): inject steers stashed via
  // `redirect()` as `additionalContext` at the next tool boundary — PostToolBatch (guaranteed
  // before the next model request) or PreToolUse; otherwise the turn-end `steer-undelivered`
  // fallback queues them. The synchronous splice makes the take once-only across both points.
  const takePendingSteer = (hookEventName: 'PreToolUse' | 'PostToolBatch'): HookJSONOutput => {
    // Resolve the steer holder by id at fire-time — the prewarm-baked hook must read the live
    // holder the connection wired, not a holder instance captured before this connection existed.
    const holder = sessionState().getSteerHolder(sessionId)
    if (holder.pending.length === 0) return {}

    const taken = holder.pending.splice(0)
    const text = taken
      .map(extractSteerText)
      .filter((t) => t.trim())
      .join('\n\n')
    if (!text) {
      holder.pending.unshift(...taken)
      return {}
    }
    logger.info('Injecting steer into the running turn', {
      sessionId,
      count: taken.length,
      hook: hookEventName
    })
    // Arm the connection's `steer-boundary` (rolls A1a + A2) — fired only when we actually inject.
    holder.onInjected?.(taken)
    const additionalContext = wrapSteerReminder(text)
    return hookEventName === 'PreToolUse'
      ? { continue: true, hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext } }
      : { continue: true, hookSpecificOutput: { hookEventName: 'PostToolBatch', additionalContext } }
  }

  const steerHook: HookCallback = async (input): Promise<HookJSONOutput> => {
    if (!input || input.hook_event_name !== 'PreToolUse') return {}
    return takePendingSteer('PreToolUse')
  }

  const postToolBatchSteerHook: HookCallback = async (input): Promise<HookJSONOutput> => {
    if (!input || input.hook_event_name !== 'PostToolBatch') return {}
    return takePendingSteer('PostToolBatch')
  }

  const agentsMdHook = ctx.agentsMdLoader.createPreToolUseHook()

  const postToolTimingHook: HookCallback = async (input): Promise<HookJSONOutput> => {
    if (!input || (input.hook_event_name !== 'PostToolUse' && input.hook_event_name !== 'PostToolUseFailure')) {
      return {}
    }
    const event = input as unknown as Record<string, unknown>
    const toolCallId = event.tool_use_id
    const toolName = event.tool_name
    const durationMs = event.duration_ms
    if (
      typeof toolCallId !== 'string' ||
      typeof toolName !== 'string' ||
      typeof durationMs !== 'number' ||
      !Number.isFinite(durationMs) ||
      durationMs < 0
    ) {
      return {}
    }
    application.get('AgentSessionRuntimeService').recordToolExecutionTiming(sessionId, {
      toolCallId,
      toolName,
      durationMs
    })
    return {}
  }

  return {
    PreToolUse: [{ hooks: [toolGuardHook, skillDependencyAdvisoryHook, agentsMdHook, rtkRewriteHook, steerHook] }],
    PostToolUse: [{ hooks: [postToolTimingHook] }],
    PostToolUseFailure: [{ hooks: [postToolTimingHook] }],
    PostToolBatch: [{ hooks: [postToolBatchSteerHook] }]
  }
}
