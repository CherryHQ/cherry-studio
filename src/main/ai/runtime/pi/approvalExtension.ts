/**
 * pi tool-call policy + approval extension (plan D1/D4).
 *
 * pi exposes a single `tool_call` hook that can BOTH block execution and mutate
 * `event.input` in place, so it absorbs three of Claude's four PreToolUse hooks
 * (disabled-tool enforce, global-install block, rtk rewrite) plus the interactive
 * approval round-trip. Steering (the 4th) is deferred (plan D6).
 *
 * Pipeline per `tool_call`:
 *   1. rtk rewrite    → mutate `event.input.command` in place (bash only, all modes)
 *   2. classify facts → extract paths, shell text, and built-in conduct tags
 *   3. evaluate       → shared disabled/global/mode/conduct policy, then ask/allow/deny
 *   4. approval       → register + emit a runtime-neutral request, then block / allow / apply edit
 *
 * The gate keys off pi's lowercase built-in tool names; it never assumes Claude
 * casing (plan D8). `tool_execution_start` fires (in the pi agent loop) BEFORE
 * this hook even on a block, so the stream adapter has already produced the tool
 * part by the time the approval request references its `toolCallId`.
 */
import { randomUUID } from 'node:crypto'

import type { ToolCategory } from '@cherrystudio/agent-permission'
import { type AgentPermissionMode, normalizeLegacyPermissionMode } from '@cherrystudio/agent-permission'
import { evaluatePermission, type PermissionCall } from '@cherrystudio/agent-permission/node'
import type { ExtensionAPI, ExtensionContext, ExtensionFactory, ToolCallEvent } from '@earendil-works/pi-coding-agent'
import { loggerService } from '@logger'
import {
  detectDestructiveAssistantCommand,
  isGitHubIssueCreationCommand,
  isLarkFormSubmissionCommand,
  isPermanentDeletionToolName
} from '@main/ai/agents/builtin/assistantCommandSafety'
import { type DispatchDecision, toolApprovalRegistry } from '@main/ai/toolApproval'
import { rtkRewrite } from '@main/utils/rtk'
import { PI_BUILTIN_TOOLS, PI_TOOL_EXEC_TOOL_NAME } from '@shared/ai/piBuiltinTools'
import type { CherryToolMeta } from '@shared/data/types/uiParts'

import type { AgentRuntimeEvent } from '../types'
import { PI_TRANSPORT } from './piStreamAdapter'

const logger = loggerService.withContext('PiApprovalExtension')

/** pi built-in read-only tools — allowed by the shared evaluator only when their `path` resolves
 *  inside the session workspace or current agent data directory. */
const READ_ONLY_TOOLS = new Set<string>(
  PI_BUILTIN_TOOLS.filter((tool) => tool.permissionClass === 'read').map((tool) => tool.name)
)
/** pi built-in edit-class tools — auto-approved in `edit` (still gated in `default`), same
 *  allowed-root scoping as the read-only set. */
const EDIT_TOOLS = new Set<string>(
  PI_BUILTIN_TOOLS.filter((tool) => tool.permissionClass === 'edit').map((tool) => tool.name)
)
/** Code Mode discovery and dispatch authorize their target separately, so their own calls never
 * participate in file-path containment or add a redundant prompt. */
const META_TOOLS = new Set<string>(
  PI_BUILTIN_TOOLS.filter((tool) => tool.permissionClass === 'meta').map((tool) => tool.name)
)

export interface PiApprovalContext {
  /** Agent-session id — keys the neutral registry so close()/abort target the right approvals. */
  sessionId: string
  /** Session workspace root used to resolve relative tool paths and as a trusted read/write root. */
  workspacePath: string
  /** Current agent's persistent identity and memory directory. It is a trusted file-tool root just
   *  like the workspace; paths under another agent or elsewhere still require approval. */
  agentDataPath: string
  /** Built-in role facts used by the shared product-conduct evaluator. */
  builtinRole?: string
  /** MCP servers mounted for this session, forwarded as same-process policy context. */
  mountedServers: ReadonlySet<string>
  /** Root turn kind. Code Mode nested calls use the same root policy and are not delegated. */
  turn: 'interactive' | 'headless'
  delegated: boolean
  /** Push a runtime-neutral event into the connection queue; the host owns presentation. */
  emit: (event: AgentRuntimeEvent) => void
  /** Resolve responder availability at tool fire-time so warm connections follow the current turn. */
  getInteractionState: () => { userResponse: 'stream' | 'message' | 'unavailable' }
  /** Live permission mode; read at fire-time so a warm-connection `reconcile` takes effect. */
  getPermissionMode: () => AgentPermissionMode | string | undefined
  /** Live disabled-tool predicate; read at fire-time for the same reason. */
  isDisabled: (toolName: string) => boolean
  /** Cherry-owned soul/autonomy tools (`cron`/`notify`/`config`/`memory`) auto-approved in every
   *  permission mode — they drive unattended heartbeat turns, so gating them would deadlock. Fixed
   *  for the session's lifetime; empty when soul mode is off. The `isDisabled` block still hard-blocks
   *  them (disabled beats auto-allow). */
  autoApprovedTools: ReadonlySet<string>
  /** Runtime-neutral Cherry/Assistant tools that always require a live per-call decision. */
  approvalRequiredTools: ReadonlySet<string>
  /** Delegation tools whose live-approval ceiling remains in Full Access. */
  nonBypassableApprovalTools: ReadonlySet<string>
}

export function createPiApprovalExtension(ctx: PiApprovalContext): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    pi.on('tool_call', async (event: ToolCallEvent, extCtx: ExtensionContext) => {
      return createPiToolAuthorizer(ctx)({
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        input: event.input as Record<string, unknown>,
        signal: extCtx.signal
      })
    })
  }
}

export interface PiToolAuthorizationRequest {
  toolName: string
  toolCallId: string
  input: Record<string, unknown>
  signal?: AbortSignal
  /** Pauses outer execution accounting while the user decides this nested call. */
  onApprovalPending?: () => () => void
}

export type PiToolAuthorizer = (
  request: PiToolAuthorizationRequest
) => Promise<{ block: true; reason: string } | undefined>

/** Reusable policy boundary for native Pi calls and nested code-mode calls. */
export function createPiToolAuthorizer(ctx: PiApprovalContext): PiToolAuthorizer {
  return async ({ toolName, toolCallId, input, signal, onApprovalPending }) => {
    const interactionState = ctx.getInteractionState()
    const mode = normalizeLegacyPermissionMode(ctx.getPermissionMode() ?? 'default')

    // Pi lets this hook rewrite input in place. Rewrite first, then classify/evaluate the final
    // command so the policy sees exactly what the runtime will execute.
    if (toolName === 'bash') {
      const command = typeof input.command === 'string' ? input.command : ''
      if (command.trim()) {
        const rewritten = await rtkRewrite(command)
        if (rewritten) {
          logger.info('rtk rewrote bash command', { original: command, rewritten })
          input.command = rewritten
        }
      }
    }

    const decision = await evaluatePermission(
      {
        toolName,
        category: categorizeTool(toolName, ctx),
        paths: extractStructuredPaths(toolName, input),
        command: extractCommand(toolName, input),
        allowMissingTarget: EDIT_TOOLS.has(toolName),
        conductTags: extractConductTags(toolName, input, ctx.builtinRole)
      },
      {
        mode,
        roots: { workspace: ctx.workspacePath, agentData: ctx.agentDataPath },
        isDisabled: ctx.isDisabled,
        responder: interactionState.userResponse,
        // A missing responder is the runtime's authoritative headless signal until the
        // turn-scoped authority is threaded through in the persistence/channel phase.
        turn: interactionState.userResponse === 'unavailable' ? 'headless' : ctx.turn,
        delegated: ctx.delegated,
        builtinRole: ctx.builtinRole,
        guardContext: { input, mountedServers: ctx.mountedServers },
        log: (event) => logger.error(event.message, event)
      }
    )

    if (decision.effect === 'allow') return
    if (decision.effect === 'deny') return { block: true, reason: decision.reason }

    const approvalId = randomUUID()
    const presentation = decision.presentation
    const resumeExecutionTimeout = onApprovalPending?.()
    let registryDecision: DispatchDecision
    try {
      registryDecision = await new Promise<DispatchDecision>((resolve) => {
        const pending = toolApprovalRegistry.register({
          approvalId,
          sessionId: ctx.sessionId,
          toolCallId,
          toolName,
          originalInput: { ...input },
          presentation,
          signal,
          resolve
        })
        // Only surface the approval card when the request is actually pending; a
        // synchronous resolve (e.g. the turn was aborted as the tool fired) already
        // settled the promise, and emitting would leave an unanswerable card.
        if (!pending) return
        ctx.emit({
          type: 'tool-approval-request',
          request: {
            approvalId,
            toolCallId,
            toolName,
            input: { ...input },
            presentation,
            providerMetadata: { cherry: { transport: PI_TRANSPORT, toolName } satisfies CherryToolMeta }
          }
        })
      })
    } finally {
      resumeExecutionTimeout?.()
    }

    if (!registryDecision.approved) {
      return { block: true, reason: registryDecision.reason ?? 'User denied permission for this tool.' }
    }
    if (registryDecision.updatedInput) applyInputEdit(input, registryDecision.updatedInput)
    return
  }
}

function categorizeTool(toolName: string, context: PiApprovalContext): ToolCategory {
  if (context.nonBypassableApprovalTools.has(toolName)) return 'non-bypassable'
  if (context.approvalRequiredTools.has(toolName)) return 'sensitive-first-party'
  if (META_TOOLS.has(toolName)) return 'meta'
  if (READ_ONLY_TOOLS.has(toolName)) return 'read'
  if (EDIT_TOOLS.has(toolName)) return 'edit'
  if (toolName === 'bash' || toolName === PI_TOOL_EXEC_TOOL_NAME) return 'shell'
  if (context.autoApprovedTools.has(toolName)) return 'safe-first-party'
  return 'ordinary'
}

function extractStructuredPaths(toolName: string, input: Record<string, unknown>): readonly string[] | undefined {
  if (!READ_ONLY_TOOLS.has(toolName) && !EDIT_TOOLS.has(toolName)) return undefined
  const raw = input.path
  if (raw === undefined || raw === null || raw === '') return ['.']
  return typeof raw === 'string' ? [raw] : []
}

function extractCommand(toolName: string, input: Record<string, unknown>): string | undefined {
  if (toolName !== 'bash') return undefined
  return typeof input.command === 'string' ? input.command : undefined
}

function extractConductTags(
  toolName: string,
  input: Record<string, unknown>,
  builtinRole: string | undefined
): PermissionCall['conductTags'] {
  const tags: Array<NonNullable<PermissionCall['conductTags']>[number]> = []
  const command = typeof input.command === 'string' ? input.command : ''
  if (
    builtinRole &&
    ((toolName === 'bash' && detectDestructiveAssistantCommand(command)) || isPermanentDeletionToolName(toolName))
  ) {
    tags.push('permanent-delete')
  }
  if (
    builtinRole === 'assistant' &&
    toolName === 'bash' &&
    (isLarkFormSubmissionCommand(command) || isGitHubIssueCreationCommand(command))
  ) {
    tags.push('feedback-submission')
  }
  const action = typeof input.action === 'string' ? input.action : ''
  if ((toolName === 'config' || toolName.endsWith('__config')) && HEADLESS_CONFIG_MUTATION_ACTIONS.has(action)) {
    tags.push('agent-config-mutation')
  }
  return tags.length > 0 ? tags : undefined
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

/** Replace the tool input in place with the renderer's edited copy (pi mutates `event.input`). */
function applyInputEdit(input: Record<string, unknown>, updated: Record<string, unknown>): void {
  for (const key of Object.keys(input)) delete input[key]
  Object.assign(input, updated)
}
