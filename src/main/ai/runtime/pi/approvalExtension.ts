/**
 * pi tool-call policy + approval extension (plan D1/D4).
 *
 * pi exposes a single `tool_call` hook that can BOTH block execution and mutate
 * `event.input` in place, so it absorbs three of Claude's four PreToolUse hooks
 * (disabled-tool enforce, global-install block, rtk rewrite) plus the interactive
 * approval round-trip. Steering (the 4th) is deferred (plan D6).
 *
 * Pipeline per `tool_call`:
 *   1. disabledTools  → block (all modes)
 *   2. global-install → block bash that installs into shared/global locations (all modes)
 *   3. rtk rewrite    → mutate `event.input.command` in place (bash only)
 *   4. approval       → per permission mode: auto-allow, or register + emit a
 *      `tool-approval-request` chunk, await the renderer decision, then
 *      block / allow / apply the edited input.
 *
 * The gate keys off pi's lowercase built-in tool names; it never assumes Claude
 * casing (plan D8). `tool_execution_start` fires (in the pi agent loop) BEFORE
 * this hook even on a block, so the stream adapter has already produced the tool
 * part by the time the approval request references its `toolCallId`.
 */
import { randomUUID } from 'node:crypto'

import type { LanguageModelV3ToolApprovalRequest } from '@ai-sdk/provider'
import type { ExtensionAPI, ExtensionContext, ExtensionFactory, ToolCallEvent } from '@earendil-works/pi-coding-agent'
import { loggerService } from '@logger'
import { rtkRewrite } from '@main/utils/rtk'
import type { AgentPermissionMode } from '@shared/data/api/schemas/agents'
import type { CherryUIMessageChunk } from '@shared/data/types/message'
import type { CherryToolMeta } from '@shared/data/types/uiParts'

import { detectGlobalInstall } from '../claudeCode/dependencyGuard'
import { type DispatchDecision, toolApprovalRegistry } from '../toolApproval/ToolApprovalRegistry'
import { PI_TRANSPORT } from './piStreamAdapter'

const logger = loggerService.withContext('PiApprovalExtension')

/** pi built-in read-only tools — auto-approved in every permission mode. */
const READ_ONLY_TOOLS = new Set(['read', 'grep', 'find', 'ls'])
/** pi built-in edit-class tools — auto-approved in `acceptEdits` (still gated in `default`). */
const EDIT_TOOLS = new Set(['edit', 'write'])

export interface PiApprovalContext {
  /** Agent-session id — keys the neutral registry so close()/abort target the right approvals. */
  sessionId: string
  /** Push a chunk into the connection's event stream (bound to the AsyncEventQueue). */
  emit: (chunk: CherryUIMessageChunk) => void
  /** Live permission mode; read at fire-time so a mid-session `applyPolicyUpdate` takes effect. */
  getPermissionMode: () => AgentPermissionMode | undefined
  /** Live disabled-tool predicate; read at fire-time for the same reason. */
  isDisabled: (toolName: string) => boolean
}

export function createPiApprovalExtension(ctx: PiApprovalContext): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    pi.on('tool_call', async (event: ToolCallEvent, extCtx: ExtensionContext) => {
      const { toolName, toolCallId } = event
      // pi's `event.input` is a per-tool union; the generic gate treats it as a
      // mutable record (mutations propagate to execution — pi mutates in place).
      const input = event.input as Record<string, unknown>

      // (1) disabledTools — block regardless of permission mode.
      if (ctx.isDisabled(toolName)) {
        return { block: true, reason: `Tool "${toolName}" is disabled for this agent.` }
      }

      // (2)/(3) bash-specific guards: block global installs, then rtk-rewrite in place.
      if (toolName === 'bash') {
        const command = typeof input.command === 'string' ? input.command : ''
        if (command.trim()) {
          const reason = detectGlobalInstall(command)
          if (reason) {
            logger.info('Blocked global install to prevent dependency pollution', { sessionId: ctx.sessionId, reason })
            return {
              block: true,
              reason: `Blocked to avoid cross-agent dependency pollution: ${reason}. Install into the current project instead (e.g. \`bun install <pkg>\`, or \`uv run --with <pkg> python\`); for one-off tools use \`bun x <tool>\` / \`uvx <tool>\`.`
            }
          }
          const rewritten = await rtkRewrite(command)
          if (rewritten) {
            logger.info('rtk rewrote bash command', { original: command, rewritten })
            input.command = rewritten
          }
        }
      }

      // (4) approval by permission mode.
      const mode = ctx.getPermissionMode() ?? 'default'
      if (!requiresApproval(mode, toolName)) return

      const approvalId = randomUUID()
      const decision = await new Promise<DispatchDecision>((resolve) => {
        toolApprovalRegistry.register({
          approvalId,
          sessionId: ctx.sessionId,
          toolCallId,
          toolName,
          originalInput: { ...input },
          signal: extCtx.signal,
          resolve
        })
        const request: LanguageModelV3ToolApprovalRequest = {
          type: 'tool-approval-request',
          approvalId,
          toolCallId,
          providerMetadata: { cherry: { transport: PI_TRANSPORT, toolName } satisfies CherryToolMeta }
        }
        ctx.emit(request)
      })

      if (!decision.approved) {
        return { block: true, reason: decision.reason ?? 'User denied permission for this tool.' }
      }
      if (decision.updatedInput) applyInputEdit(input, decision.updatedInput)
      return
    })
  }
}

/** Whether a tool must surface an approval request under the given mode. */
function requiresApproval(mode: AgentPermissionMode, toolName: string): boolean {
  if (mode === 'bypassPermissions') return false
  if (READ_ONLY_TOOLS.has(toolName)) return false
  if (mode === 'acceptEdits' && EDIT_TOOLS.has(toolName)) return false
  // `default` (and the unsupported-for-pi `plan`) gate everything else.
  return true
}

/** Replace the tool input in place with the renderer's edited copy (pi mutates `event.input`). */
function applyInputEdit(input: Record<string, unknown>, updated: Record<string, unknown>): void {
  for (const key of Object.keys(input)) delete input[key]
  Object.assign(input, updated)
}
