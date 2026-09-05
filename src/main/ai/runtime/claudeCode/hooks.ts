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
import type { ClaudeCodeSettings } from './types'

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
  agentsMdLoader: AgentsMdLoader
}

export function buildClaudeCodeHooks(ctx: ClaudeCodeHookContext): ClaudeCodeSettings['hooks'] {
  const { sessionId, cwd, agentDataPath } = ctx

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
      supportsImages: ctx.supportsImages,
      interaction: application.get('AgentSessionRuntimeService').getInteractionState(sessionId),
      isDisabled: (name) => snapshot?.isDisabled(name) ?? false,
      bashNoProgressRun: (command) => sessionState().getBashNoProgressRun(sessionId, command, input.agent_id)
    })
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

    const rewritten = await rtkRewrite(command)
    if (!rewritten) return {}
    logger.info('rtk rewrote Bash command', { original: command, rewritten })
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: { ...toolInput, command: rewritten } } }
  }

  // Real mid-turn steer (the agent SDK has no native steer API): when a steer is stashed via the
  // connection's `redirect()`, inject it as `additionalContext` before the next tool runs so the
  // model can change direction without aborting. If the turn ends with no tool call, the connection
  // emits `steer-undelivered` and the host queues it as the next turn instead.
  const steerHook: HookCallback = async (input): Promise<HookJSONOutput> => {
    if (!input || input.hook_event_name !== 'PreToolUse') return {}
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
    logger.info('Injecting steer into the running turn via PreToolUse hook', {
      sessionId,
      count: taken.length
    })
    // Arm the connection's `steer-boundary` (rolls A1a + A2) — fired only when we actually inject.
    holder.onInjected?.(taken)
    return {
      continue: true,
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: wrapSteerReminder(text) }
    }
  }

  const agentsMdHook = ctx.agentsMdLoader.createPreToolUseHook()

  // Subagent Bash history is scoped per agent_id; when the subagent stops, its scope is dropped so
  // long-lived sessions don't retain every completed child's history until whole-session disposal.
  const subagentStopHook: HookCallback = async (input): Promise<HookJSONOutput> => {
    if (!input || input.hook_event_name !== 'SubagentStop') return {}
    sessionState().disposeBashScope(sessionId, input.agent_id)
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

    const command = (input.tool_input as { command?: unknown } | undefined)?.command
    if (typeof command !== 'string') return {}

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
    PostToolUse: [{ hooks: [postToolTimingHook, bashOutcomeHook] }],
    PostToolUseFailure: [{ hooks: [postToolTimingHook, bashOutcomeHook] }],
    SubagentStop: [{ hooks: [subagentStopHook] }]
  }
}
