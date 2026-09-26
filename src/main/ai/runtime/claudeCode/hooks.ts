/**
 * PreToolUse / PostToolUse / PostToolBatch hook assembly for a Claude Code session.
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

import type { HookCallback, HookInput, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk'

import { application } from '@application'
import { loggerService } from '@logger'
import { wrapSteerReminder } from '@main/ai/steerReminder'
import { CHERRY_MCP_SERVER, toMcpRuntimeName } from '@main/ai/toolApproval/builtinToolPolicy'
import { evaluateToolGuards } from '@main/ai/toolApproval/toolGuards'
import { MOVE_TO_TRASH_TOOL_NAME } from '@main/ai/tools/moveToTrash'
import { SAVE_ATTACHMENT_TOOL_NAME } from '@main/ai/tools/saveAttachment'
import { rtkRewrite } from '@main/utils/rtk'

import type { AgentRuntimeUserInput } from '../types'
import type { AgentsMdLoader } from './AgentsMdLoader'
import { BASH_NO_PROGRESS_HARD_THRESHOLD, BASH_NO_PROGRESS_THRESHOLD, BASH_RUN_BREAK_TOOLS } from './bashNoProgress'
import { CLAUDE_TOOL_GUARD_RULES } from './guardRules'
import { checkSkillRuntimeDependencies, SKILL_TOOL_NAME } from './skillDependencies'
import type { ClaudeCodeSettings, SubagentImageSupport } from './types'

const logger = loggerService.withContext('ClaudeCodeHooks')
const EXIT_PLAN_MODE_TOOL_NAME = 'ExitPlanMode'

// Tools whose successful completion mutates the workspace and therefore breaks a no-progress run:
// the native edit tools, plus the assistant-files MCP tools (referenced by runtime name).
const RUN_BREAK_TOOLS: ReadonlySet<string> = new Set([
  ...BASH_RUN_BREAK_TOOLS,
  toMcpRuntimeName({ serverName: CHERRY_MCP_SERVER.ASSISTANT_FILES, toolName: SAVE_ATTACHMENT_TOOL_NAME }),
  toMcpRuntimeName({ serverName: CHERRY_MCP_SERVER.ASSISTANT_FILES, toolName: MOVE_TO_TRASH_TOOL_NAME })
])

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
  /** Per-alias image support from the effective route; subagent requests resolve against it. */
  subagentImageSupport?: SubagentImageSupport
  agentsMdLoader: AgentsMdLoader
}

export function buildClaudeCodeHooks(ctx: ClaudeCodeHookContext): ClaudeCodeSettings['hooks'] {
  const { sessionId, cwd, agentDataPath } = ctx

  // SubagentStart carries no model, so Task/Agent launches are tagged by tool_use_id and bound
  // to the child agent_id at start (forks keep the parent value: they run on the parent model).
  // Backgrounded launches resolve (PostToolUse + PostToolBatch) at acknowledgement time while
  // their SubagentStart arrives later, so their tags survive the success planes until bound.
  const pendingSubagentLaunches = new Map<string, { agentType: string; support: boolean; background: boolean }>()
  const activeSubagentImageSupport = new Map<string, boolean>()
  const MAX_PENDING_SUBAGENT_LAUNCHES = 50

  const launchAgentType = (input: Record<string, unknown> | undefined): string => {
    const raw = input?.subagent_type ?? input?.agent_type
    return typeof raw === 'string' ? raw : ''
  }

  const resolveLaunchImageSupport = (input: Record<string, unknown> | undefined): boolean => {
    if (launchAgentType(input).trim().toLowerCase() === 'fork') return ctx.supportsImages
    const requested = typeof input?.model === 'string' ? input.model.trim().toLowerCase() : ''
    if (requested === '' || requested === 'inherit') return ctx.supportsImages
    if (requested === 'haiku' || requested === 'sonnet' || requested === 'opus') {
      const support = ctx.subagentImageSupport?.[requested]
      if (support !== undefined) return support
      logger.debug('Subagent alias has no resolved capability; inheriting session value', { requested })
      return ctx.supportsImages
    }
    logger.debug('Subagent launch has no mappable model alias; inheriting session value', { requested })
    return ctx.supportsImages
  }

  // A backgrounded Task/Agent call resolves at acknowledgement time, before its SubagentStart
  // arrives; a foreground call resolves after its child started (and usually completed).
  const isBackgroundLaunch = (input: Record<string, unknown> | undefined): boolean => {
    if (input?.run_in_background === true) return true
    // Remote-isolation agents always run in the background (SDK AgentInput).
    return input?.isolation === 'remote'
  }

  const rememberSubagentLaunch = (toolUseId: string, input: Record<string, unknown> | undefined): void => {
    if (pendingSubagentLaunches.size >= MAX_PENDING_SUBAGENT_LAUNCHES) {
      const oldest = pendingSubagentLaunches.keys().next()
      if (!oldest.done) {
        logger.debug('Dropping oldest pending subagent launch', { toolUseId: oldest.value })
        pendingSubagentLaunches.delete(oldest.value)
      }
    }
    pendingSubagentLaunches.set(toolUseId, {
      agentType: launchAgentType(input),
      support: resolveLaunchImageSupport(input),
      background: isBackgroundLaunch(input)
    })
  }

  const takePendingLaunch = (agentType: string): boolean | undefined => {
    for (const [id, entry] of pendingSubagentLaunches) {
      if (entry.agentType === agentType) {
        pendingSubagentLaunches.delete(id)
        return entry.support
      }
    }
    for (const [id, entry] of pendingSubagentLaunches) {
      if (entry.agentType === '') {
        logger.debug('Binding untyped subagent launch by arrival order', { agentType })
        pendingSubagentLaunches.delete(id)
        return entry.support
      }
    }
    return undefined
  }

  const forgetSubagentLaunch = (toolName: string, toolUseId: unknown, keepBackground: boolean): void => {
    if ((toolName === 'Task' || toolName === 'Agent') && typeof toolUseId === 'string') {
      // Retracting a backgrounded launch on the success planes would drop the child's capability
      // before its later SubagentStart binds it; failure/denial planes always retract because a
      // failed or denied launch never produces a SubagentStart.
      if (keepBackground && pendingSubagentLaunches.get(toolUseId)?.background) return
      pendingSubagentLaunches.delete(toolUseId)
    }
  }

  // The single policy hook: evaluates the guard table with a fire-time context snapshot. Runs as a
  // PreToolUse hook (not in canUseTool) because hooks fire under every permission mode, while the
  // SDK skips canUseTool on auto-approved paths.
  const toolGuardHook: HookCallback = async (input, toolUseId, options): Promise<HookJSONOutput> => {
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
      signal: options?.signal,
      supportsImages: input.agent_id
        ? (activeSubagentImageSupport.get(input.agent_id) ?? ctx.supportsImages)
        : ctx.supportsImages,
      interaction: application.get('AgentSessionRuntimeService').getInteractionState(sessionId),
      isDisabled: (name) => snapshot?.isDisabled(name) ?? false,
      bashNoProgressRun: (command) => sessionState().getBashNoProgressRun(sessionId, command, input.agent_id)
    })
    // Tag Task/Agent launches that this plane did not deny; failure, denial, and batch-end
    // sweeps below retract the tag when no SubagentStart consumes it. Backgrounded launches keep
    // their tag on the success planes because their SubagentStart arrives after acknowledgement.
    if ((toolName === 'Task' || toolName === 'Agent') && decision?.effect !== 'deny') {
      rememberSubagentLaunch(input.tool_use_id, toolInput)
    }
    if (!decision) {
      // Soft tier of the bash-repeat-no-progress guard (the hard deny is the guard rule): the
      // first call past the soft threshold is allowed with a one-shot warning so the model can
      // self-correct; exactly-at-threshold fires it once, before the run grows past it.
      if (toolName === 'Bash' && typeof toolInput?.command === 'string') {
        const run = sessionState().getBashNoProgressRun(sessionId, toolInput.command, input.agent_id)
        if (run === BASH_NO_PROGRESS_THRESHOLD) {
          return {
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              additionalContext: `Loop warning: this exact Bash command has already run ${run} times in a row with byte-identical output, and is denied outright once the run reaches ${BASH_NO_PROGRESS_HARD_THRESHOLD}. If you are waiting for a change, make the edit first; if you are stuck, diagnose the cause or report the blocker instead of retrying.`
            }
          }
        }
      }
      return {}
    }
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

    // Register before yielding so an in-flight rewrite cannot recreate state after teardown.
    sessionState().recordBashRewriteOrigin(sessionId, input.tool_use_id, command)
    const rewritten = await rtkRewrite(command)
    if (!rewritten) {
      sessionState().takeBashRewriteOrigin(sessionId, input.tool_use_id)
      return {}
    }
    logger.info('rtk rewrote Bash command', { original: command, rewritten })
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: { ...toolInput, command: rewritten } } }
  }

  // Real mid-turn steer (the agent SDK has no native steer API): inject steers stashed via
  // `redirect()` as `additionalContext` at the next tool boundary — PostToolBatch (guaranteed
  // before the next model request) or PreToolUse; otherwise the turn-end `steer-undelivered`
  // fallback queues them. The synchronous splice makes the take once-only across both points.
  const takePendingSteer = (
    hookEventName: 'PreToolUse' | 'PostToolBatch',
    input: HookInput | undefined
  ): HookJSONOutput => {
    // A subagent boundary (`agent_id` present) must not consume the queue: the steer addresses the
    // top-level turn, and the driver only rolls `steer-boundary` at a top-level assistant message.
    if (!input || input.hook_event_name !== hookEventName || input.agent_id) return {}
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
    return {
      continue: true,
      hookSpecificOutput: { hookEventName, additionalContext: wrapSteerReminder(text) }
    }
  }

  const steerHook: HookCallback = async (input) => takePendingSteer('PreToolUse', input)
  const postToolBatchSteerHook: HookCallback = async (input) => takePendingSteer('PostToolBatch', input)

  const bashRewriteCleanupHook: HookCallback = async (input) => {
    if (input.hook_event_name !== 'PostToolBatch') return {}
    // Denied calls have no PostToolUse event; consume only this batch's leftovers.
    for (const call of input.tool_calls) sessionState().takeBashRewriteOrigin(sessionId, call.tool_use_id)
    return {}
  }

  const agentsMdHook = ctx.agentsMdLoader.createPreToolUseHook()

  // Subagent Bash history is scoped per agent_id; when the subagent stops, its scope is dropped so
  // long-lived sessions don't retain every completed child's history until whole-session disposal.
  const subagentStopHook: HookCallback = async (input): Promise<HookJSONOutput> => {
    if (!input || input.hook_event_name !== 'SubagentStop') return {}
    activeSubagentImageSupport.delete(input.agent_id)
    sessionState().disposeBashScope(sessionId, input.agent_id)
    return {}
  }

  const subagentStartHook: HookCallback = async (input): Promise<HookJSONOutput> => {
    if (!input || input.hook_event_name !== 'SubagentStart') return {}
    const support = takePendingLaunch(input.agent_type)
    if (support !== undefined) activeSubagentImageSupport.set(input.agent_id, support)
    return {}
  }

  // Retracts launch tags that never bound: the launch failed, was denied, or completed. Denied
  // calls emit no PostToolUse, so the denial and batch-end planes are required, not belt-and-braces.
  // Backgrounded launches keep their tag on the success planes: they resolve at acknowledgement
  // time while their SubagentStart arrives later.
  const postToolUseCleanupHook: HookCallback = async (input): Promise<HookJSONOutput> => {
    if (!input || (input.hook_event_name !== 'PostToolUse' && input.hook_event_name !== 'PostToolUseFailure')) {
      return {}
    }
    forgetSubagentLaunch(input.tool_name, input.tool_use_id, input.hook_event_name === 'PostToolUse')
    return {}
  }

  const permissionDeniedCleanupHook: HookCallback = async (input): Promise<HookJSONOutput> => {
    if (!input || input.hook_event_name !== 'PermissionDenied') return {}
    forgetSubagentLaunch(input.tool_name, input.tool_use_id, false)
    return {}
  }

  const postToolBatchCleanupHook: HookCallback = async (input): Promise<HookJSONOutput> => {
    if (!input || input.hook_event_name !== 'PostToolBatch') return {}
    // The batch fires at acknowledgement time for backgrounded launches, so their tags survive
    // here the same way they survive PostToolUse; foreground leftovers are still reaped.
    for (const call of input.tool_calls) forgetSubagentLaunch(call.tool_name, call.tool_use_id, true)
    return {}
  }

  // Feeds the bash-repeat-no-progress guard rule. History is scoped per agent: subagent hook
  // events carry agent_id, and a child's repeated calls must not poison the parent's run
  // detection (and vice versa). A user interrupt (Esc) is a deliberate stop, so it counts as
  // progress and CLEARS the signal — merely skipping the recording would leave a trailing run in
  // place and the user's next retry would still be denied. Esc surfaces either as
  // PostToolUseFailure with is_interrupt, or as PostToolUse whose Bash tool_response carries
  // interrupted: true.
  const bashOutcomeHook: HookCallback = async (input): Promise<HookJSONOutput> => {
    if (!input || (input.hook_event_name !== 'PostToolUse' && input.hook_event_name !== 'PostToolUseFailure')) {
      return {}
    }
    const agentId = input.agent_id

    if (input.tool_name !== 'Bash') {
      // A completed mutating tool changed the workspace: break the run so a verifier still printing
      // the same remaining errors is not misread as a stuck loop. Read-only tools do not break it —
      // an agent alternating Bash with Read is still looping.
      if (input.hook_event_name === 'PostToolUse' && RUN_BREAK_TOOLS.has(input.tool_name)) {
        sessionState().recordBashRunBreak(sessionId, agentId)
      }
      return {}
    }

    const executedCommand = (input.tool_input as { command?: unknown } | undefined)?.command
    if (typeof executedCommand !== 'string') return {}
    const command = sessionState().takeBashRewriteOrigin(sessionId, input.tool_use_id) ?? executedCommand

    if (input.hook_event_name === 'PostToolUseFailure') {
      if (input.is_interrupt === true) {
        sessionState().recordBashRunBreak(sessionId, agentId)
        return {}
      }
      sessionState().recordBashOutcome(sessionId, command, input.error, true, agentId)
      return {}
    }

    const response = input.tool_response
    if (
      typeof response === 'object' &&
      response !== null &&
      (response as { interrupted?: unknown }).interrupted === true
    ) {
      sessionState().recordBashRunBreak(sessionId, agentId)
      return {}
    }
    sessionState().recordBashOutcome(sessionId, command, response, false, agentId)
    return {}
  }

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
    PostToolUse: [{ hooks: [postToolTimingHook, bashOutcomeHook, postToolUseCleanupHook] }],
    PostToolUseFailure: [{ hooks: [postToolTimingHook, bashOutcomeHook, postToolUseCleanupHook] }],
    PostToolBatch: [{ hooks: [postToolBatchSteerHook, bashRewriteCleanupHook, postToolBatchCleanupHook] }],
    PermissionDenied: [{ hooks: [permissionDeniedCleanupHook] }],
    SubagentStart: [{ hooks: [subagentStartHook] }],
    SubagentStop: [{ hooks: [subagentStopHook] }]
  }
}
