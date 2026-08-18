/**
 * PreToolUse / PostToolUse hook assembly for a Claude Code session.
 *
 * All hooks resolve live session state (policy snapshot, steer holder, interaction state) by
 * session id at fire-time through ClaudeCodeSessionStateService — never by closure capture — so a
 * warm-pooled query's prewarm-baked hooks observe mid-session updates. The SDK runs the whole
 * matcher group in parallel and folds decisions by severity, so array order carries no semantics;
 * the assembly in `buildClaudeCodeHooks` is the single place the set is defined.
 */

import type { HookCallback, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk'
import { application } from '@application'
import { loggerService } from '@logger'
import { wrapSteerReminder } from '@main/ai/steerReminder'
import { rtkRewrite } from '@main/utils/rtk'
import { CONFIG_TOOL_NAME } from '@shared/ai/builtinTools'

import { toCherryBuiltinRuntimeName } from '../toolApproval/cherryBuiltinApproval'
import { detectGlobalInstall } from '../toolApproval/dependencyGuard'
import type { AgentRuntimeUserInput } from '../types'
import type { AgentsMdLoader } from './AgentsMdLoader'
import {
  detectDestructiveAssistantCommand,
  isGitHubIssueCreationCommand,
  isLarkFormSubmissionCommand,
  isPermanentDeletionToolName
} from './assistantCommandSafety'
import {
  ASK_USER_QUESTION_TOOL_NAME,
  HEADLESS_INTERACTIVE_TOOL_DENIAL,
  HEADLESS_INTERACTIVE_TOOLS,
  WORKSPACE_PATH_FIELDS
} from './guardRules'
import { isPathWithinAllowedRoots } from './pathContainment'
import type { ClaudeCodeSettings } from './types'

const logger = loggerService.withContext('ClaudeCodeHooks')

const sessionState = () => application.get('ClaudeCodeSessionStateService')

const HEADLESS_CONFIG_MUTATION_ACTIONS = new Set([
  'rename',
  'complete_bootstrap',
  'reset_bootstrap',
  'add_channel',
  'update_channel',
  'remove_channel',
  'reconnect_channel'
])

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
  /** Per-call approval list resolved for this session (varies with assistant MCP mounting). */
  approvalRequiredTools: readonly string[]
  isProtectedBuiltinAgent: boolean
  isAssistantBuiltinAgent: boolean
  isSupportBuiltinAgent: boolean
  agentsMdLoader: AgentsMdLoader
}

export function buildClaudeCodeHooks(ctx: ClaudeCodeHookContext): ClaudeCodeSettings['hooks'] {
  const { sessionId, cwd, agentDataPath, approvalRequiredTools } = ctx
  const { isProtectedBuiltinAgent, isAssistantBuiltinAgent, isSupportBuiltinAgent } = ctx

  // Block global/shared dependency installs before they run, to prevent cross-agent dependency
  // pollution: the runtime keeps the user's real HOME, so `-g` / `uv tool install` / `pip --user`
  // would leak into ~/.bun, ~/.local/share/uv, … shared by every session. Fires on every Bash call
  // regardless of permission mode (same rationale as disabledToolHook). Project-local installs and
  // ephemeral runners (`bun x` / `uvx`) are not flagged. Deny (not rewrite) so the model adapts to a
  // project-local install on its own — rewriting global→local semantics is fragile.
  const dependencyIsolationHook: HookCallback = async (input): Promise<HookJSONOutput> => {
    if (!input || input.hook_event_name !== 'PreToolUse') return {}
    const toolName = String((input as Record<string, unknown>).tool_name ?? '')
    if (toolName !== 'Bash') return {}
    const toolInput = (input as Record<string, unknown>).tool_input as Record<string, unknown> | undefined
    const command = toolInput?.command
    if (typeof command !== 'string' || !command.trim()) return {}
    const reason = detectGlobalInstall(command)
    if (!reason) return {}
    logger.info('Blocked global install to prevent dependency pollution', { sessionId, reason })
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `Blocked to avoid cross-agent dependency pollution: ${reason}. Install project dependencies in the current workspace (e.g. \`bun install <pkg>\`, or \`uv run --with <pkg> python\` for Python). For one-off tools use \`bun x <tool>\` / \`uvx <tool>\`; for persistent CLIs use \`cli_search\` then \`cli_install\`.`
      }
    }
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

  // Interactive-tool policy, enforced as a PreToolUse hook so it fires under every permission mode.
  // Headless turns deny tools that need a responder. Interactive AskUserQuestion calls explicitly ask
  // so bypassPermissions cannot skip `canUseTool` and execute without a user-authored answer.
  // Resolve headless state by session id at fire-time so warm connections are judged per turn.
  const interactiveToolPermissionHook: HookCallback = async (input): Promise<HookJSONOutput> => {
    if (!input || input.hook_event_name !== 'PreToolUse') return {}
    const toolName = String((input as Record<string, unknown>).tool_name ?? '')
    if (!HEADLESS_INTERACTIVE_TOOLS.includes(toolName as (typeof HEADLESS_INTERACTIVE_TOOLS)[number])) return {}

    if (application.get('AgentSessionRuntimeService').getInteractionState(sessionId).userResponse === 'unavailable') {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: HEADLESS_INTERACTIVE_TOOL_DENIAL
        }
      }
    }

    if (toolName !== ASK_USER_QUESTION_TOOL_NAME) return {}
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: 'AskUserQuestion requires a live user response.'
      }
    }
  }

  const headlessConfigMutationHook: HookCallback = async (input): Promise<HookJSONOutput> => {
    if (!input || input.hook_event_name !== 'PreToolUse') return {}
    const toolName = String((input as Record<string, unknown>).tool_name ?? '')
    if (toolName !== toCherryBuiltinRuntimeName(CONFIG_TOOL_NAME)) return {}
    const toolInput = (input as Record<string, unknown>).tool_input as Record<string, unknown> | undefined
    const action = typeof toolInput?.action === 'string' ? toolInput.action : ''
    if (!HEADLESS_CONFIG_MUTATION_ACTIONS.has(action)) return {}
    if (application.get('AgentSessionRuntimeService').getInteractionState(sessionId).currentTurn !== 'headless')
      return {}
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          'Headless channel or scheduled turns cannot mutate agent configuration. Ask the user to make this change in Cherry Studio.'
      }
    }
  }

  // Installing a skill requires the same permission handling as any other mutating tool. Interactive
  // turns defer to the SDK: default / acceptEdits prompt through canUseTool, while bypassPermissions
  // runs directly. A headless turn has no responder, so deny only when its live permission mode still
  // requires approval. Resolve the mode from the session snapshot so a warm connection observes a
  // live permission-mode update instead of the agent config captured when these hooks were built.
  const headlessSkillInstallHook: HookCallback = async (input): Promise<HookJSONOutput> => {
    if (!input || input.hook_event_name !== 'PreToolUse') return {}
    const toolName = String((input as Record<string, unknown>).tool_name ?? '')
    if (toolName !== 'mcp__skills__install_skill') return {}
    if (sessionState().getToolPolicySnapshot(sessionId)?.getPermissionMode() === 'bypassPermissions') return {}
    if (application.get('AgentSessionRuntimeService').getInteractionState(sessionId).currentTurn !== 'headless')
      return {}
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          'This channel or scheduled turn cannot approve a skill installation. Use bypassPermissions for unattended installation, or install it from an interactive turn.'
      }
    }
  }

  // disabledTools enforcement runs as a PreToolUse hook, not in `canUseTool`: the SDK skips
  // `canUseTool` for auto-approved paths (bypassPermissions / acceptEdits / default safe-tools), but
  // PreToolUse hooks fire on every tool call regardless of permission mode. The snapshot's disabled
  // set is refreshed in place on every successful agent update, so a mid-session disable is denied on
  // the warm connection in all modes without a reconnect. (A policy update that the SDK rejects is a
  // separate path — AgentSessionRuntimeService fails closed by tearing the connection down.)
  const disabledToolHook: HookCallback = async (input): Promise<HookJSONOutput> => {
    if (!input || input.hook_event_name !== 'PreToolUse') return {}
    const toolName = String((input as Record<string, unknown>).tool_name ?? '')
    if (!toolName) return {}
    // Resolve by id at fire-time so a warm-pooled query's baked hook sees the live disabled set.
    const snapshot = sessionState().getToolPolicySnapshot(sessionId)
    if (!snapshot || !snapshot.isDisabled(toolName)) return {}
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `The ${toolName} tool is disabled for this agent.`
      }
    }
  }

  // Protected built-in Agents may edit automatically, but must never turn that convenience into
  // irreversible deletion. Block permanent deletion tools and common destructive Bash operations
  // under every permission mode; confirmed workspace deletion goes through the dedicated
  // move-to-trash tool, which independently protects critical paths.
  const assistantDestructiveOperationHook: HookCallback = async (input): Promise<HookJSONOutput> => {
    if (!isProtectedBuiltinAgent || !input || input.hook_event_name !== 'PreToolUse') return {}
    const toolName = String((input as Record<string, unknown>).tool_name ?? '')
    let reason: string | undefined

    if (toolName === 'Bash') {
      const toolInput = (input as Record<string, unknown>).tool_input as Record<string, unknown> | undefined
      const command = toolInput?.command
      if (typeof command === 'string') reason = detectDestructiveAssistantCommand(command)
    } else if (isPermanentDeletionToolName(toolName)) {
      reason = 'permanent deletion tool'
    }

    if (!reason) return {}
    logger.info('Blocked destructive built-in Agent operation', { sessionId, toolName, reason })
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          `This built-in Agent blocked ${reason}. It must never permanently delete data or bypass this safeguard. ` +
          'For a confirmed file or directory inside the session workspace, use mcp__assistant-files__move_to_trash; protected paths cannot be deleted.'
      }
    }
  }

  // Cherry Assistant feedback skills submit through Bash, so the MCP-only approval list cannot
  // protect them when bypassPermissions skips canUseTool. Cherry Support has a stricter role-level
  // Bash policy below.
  const assistantFeedbackSubmissionHook: HookCallback = async (input): Promise<HookJSONOutput> => {
    if (!isAssistantBuiltinAgent || !input || input.hook_event_name !== 'PreToolUse') return {}
    const toolName = String((input as Record<string, unknown>).tool_name ?? '')
    if (toolName !== 'Bash') return {}
    const toolInput = (input as Record<string, unknown>).tool_input as Record<string, unknown> | undefined
    const command = toolInput?.command
    if (
      typeof command !== 'string' ||
      (!isLarkFormSubmissionCommand(command) && !isGitHubIssueCreationCommand(command))
    ) {
      return {}
    }

    const interactionState = application.get('AgentSessionRuntimeService').getInteractionState(sessionId)
    if (interactionState.currentTurn === 'headless' || interactionState.userResponse === 'unavailable') {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason:
            'Headless channel or scheduled turns cannot submit Cherry Studio feedback. Keep only a sanitized local feedback draft for an interactive user to review and submit.'
        }
      }
    }
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: 'Submitting Cherry Studio feedback externally requires live per-call user approval.'
      }
    }
  }

  // Support shell commands can hide external submissions behind arbitrary wrappers. Require a live
  // per-call decision for every non-destructive Bash call instead of attempting to parse commands.
  const supportBashPermissionHook: HookCallback = async (input): Promise<HookJSONOutput> => {
    if (!isSupportBuiltinAgent || !input || input.hook_event_name !== 'PreToolUse') return {}
    const toolName = String((input as Record<string, unknown>).tool_name ?? '')
    if (toolName !== 'Bash') return {}
    const toolInput = (input as Record<string, unknown>).tool_input as Record<string, unknown> | undefined
    const command = toolInput?.command
    if (typeof command === 'string' && detectDestructiveAssistantCommand(command)) return {}

    const interactionState = application.get('AgentSessionRuntimeService').getInteractionState(sessionId)
    if (interactionState.currentTurn === 'headless' || interactionState.userResponse === 'unavailable') {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason:
            'Headless channel or scheduled turns cannot run shell commands for Cherry Support. Keep only a sanitized local draft using the structured file tools.'
        }
      }
    }
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: 'Cherry Support shell commands require live per-call user approval.'
      }
    }
  }

  // `canUseTool` is skipped by the SDK under bypassPermissions and other auto-approved paths.
  // Mirror the explicit per-call approval list into PreToolUse so those tools can never inherit the
  // session's blanket permission mode.
  const approvalRequiredToolHook: HookCallback = async (input): Promise<HookJSONOutput> => {
    if (!input || input.hook_event_name !== 'PreToolUse') return {}
    const toolName = String((input as Record<string, unknown>).tool_name ?? '')
    if (!approvalRequiredTools.includes(toolName)) return {}
    if (application.get('AgentSessionRuntimeService').getInteractionState(sessionId).userResponse === 'unavailable') {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: HEADLESS_INTERACTIVE_TOOL_DENIAL
        }
      }
    }
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: `The ${toolName} tool requires per-call user approval.`
      }
    }
  }

  // `cwd` establishes the default SDK working directory but does not itself prevent an absolute
  // path from reaching a built-in file tool. Force any workspace escape back through the approval
  // path, including under acceptEdits / bypassPermissions where `canUseTool` may be skipped. This is
  // deliberately scoped to structured file-tool paths: parsing Bash text would be incomplete and
  // would create a false sandbox boundary.
  const workspacePathHook: HookCallback = async (input): Promise<HookJSONOutput> => {
    if (!input || input.hook_event_name !== 'PreToolUse') return {}
    const toolName = String((input as Record<string, unknown>).tool_name ?? '')
    const pathField = WORKSPACE_PATH_FIELDS[toolName as keyof typeof WORKSPACE_PATH_FIELDS]
    if (!pathField) return {}

    const toolInput = (input as Record<string, unknown>).tool_input as Record<string, unknown> | undefined
    const requestedPath = toolInput?.[pathField]
    // Glob/Grep intentionally omit `path` to search from cwd. Let the SDK validate missing or
    // malformed required fields for the other tools rather than duplicating their schemas here.
    if (typeof requestedPath !== 'string' || !requestedPath.trim()) return {}
    if (await isPathWithinAllowedRoots(cwd, agentDataPath, requestedPath)) {
      return {}
    }

    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: `${toolName} requested a path outside the session workspace (${cwd}) and agent data directory (${agentDataPath}): ${requestedPath}`
      }
    }
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
    PreToolUse: [
      {
        hooks: [
          interactiveToolPermissionHook,
          headlessConfigMutationHook,
          headlessSkillInstallHook,
          disabledToolHook,
          assistantDestructiveOperationHook,
          assistantFeedbackSubmissionHook,
          supportBashPermissionHook,
          approvalRequiredToolHook,
          workspacePathHook,
          agentsMdHook,
          dependencyIsolationHook,
          rtkRewriteHook,
          steerHook
        ]
      }
    ],
    PostToolUse: [{ hooks: [postToolTimingHook] }],
    PostToolUseFailure: [{ hooks: [postToolTimingHook] }]
  }
}
