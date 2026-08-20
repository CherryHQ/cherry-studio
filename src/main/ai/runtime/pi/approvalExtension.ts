/**
 * pi tool-call policy + approval extension (plan D1/D4).
 *
 * pi exposes a single `tool_call` hook that can BOTH block execution and mutate
 * `event.input` in place, so it absorbs three of Claude's four PreToolUse hooks
 * (disabled-tool enforce, global-install block, rtk rewrite) plus the interactive
 * approval round-trip. Steering (the 4th) is deferred (plan D6).
 *
 * Pipeline per `tool_call`:
 *   1. disabledTools  → block (all modes, including bypassPermissions)
 *   2. global-install → block bash that installs into shared/global locations (except bypass)
 *   3. rtk rewrite    → mutate `event.input.command` in place (bash only, all modes)
 *   4. bypass         → allow unconditionally; the mode promises no further gate
 *   5. approval       → per permission mode: auto-allow, fail closed without a
 *      responder, or register + emit a runtime-neutral approval request, then
 *      block / allow / apply the edited input.
 *
 * The gate keys off pi's lowercase built-in tool names; it never assumes Claude
 * casing (plan D8). `tool_execution_start` fires (in the pi agent loop) BEFORE
 * this hook even on a block, so the stream adapter has already produced the tool
 * part by the time the approval request references its `toolCallId`.
 */
import { randomUUID } from 'node:crypto'
import { lstat, realpath } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { ExtensionAPI, ExtensionContext, ExtensionFactory, ToolCallEvent } from '@earendil-works/pi-coding-agent'
import { loggerService } from '@logger'
import { rtkRewrite } from '@main/utils/rtk'
import { PI_BUILTIN_TOOLS } from '@shared/ai/piBuiltinTools'
import type { AgentPermissionMode } from '@shared/data/api/schemas/agents'
import type { CherryToolMeta } from '@shared/data/types/uiParts'

import { detectGlobalInstall } from '../toolApproval/dependencyGuard'
import { detectDestructiveCommand } from '../toolApproval/destructiveCommand'
import { type DispatchDecision, toolApprovalRegistry } from '../toolApproval/ToolApprovalRegistry'
import type { AgentRuntimeEvent } from '../types'
import { PI_TRANSPORT } from './piStreamAdapter'

const logger = loggerService.withContext('PiApprovalExtension')

/** pi built-in read-only tools — auto-approved in every permission mode when their `path` resolves
 *  inside the session workspace, current agent data directory, or another trusted read-only root. */
const READ_ONLY_TOOLS = new Set<string>(
  PI_BUILTIN_TOOLS.filter((tool) => tool.permissionClass === 'read').map((tool) => tool.name)
)
/** pi built-in edit-class tools — auto-approved in `acceptEdits` (still gated in `default`), same
 *  allowed-root scoping as the read-only set. */
const EDIT_TOOLS = new Set<string>(
  PI_BUILTIN_TOOLS.filter((tool) => tool.permissionClass === 'edit').map((tool) => tool.name)
)
/** Code Mode discovery and dispatch authorize their target separately, so their own calls never
 * participate in file-path containment or add a redundant prompt. */
const META_TOOLS = new Set<string>(
  PI_BUILTIN_TOOLS.filter((tool) => tool.permissionClass === 'meta').map((tool) => tool.name)
)

/** Unicode spaces pi's `normalizePath` folds to a plain space before resolving (reproduced here so
 *  containment matches pi's own `resolveToCwd`). */
const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g

export interface PiApprovalContext {
  /** Agent-session id — keys the neutral registry so close()/abort target the right approvals. */
  sessionId: string
  /** Session workspace root used to resolve relative tool paths and as a trusted read/write root. */
  workspacePath: string
  /** Current agent's persistent identity and memory directory. It is a trusted file-tool root just
   *  like the workspace; paths under another agent or elsewhere still require approval. */
  agentDataPath: string
  /** Additional app-owned roots that read tools may access without approval. Mutating file tools do
   *  not inherit these roots. */
  additionalReadOnlyRoots: readonly string[]
  /** Push a runtime-neutral event into the connection queue; the host owns presentation. */
  emit: (event: AgentRuntimeEvent) => void
  /** Resolve responder availability at tool fire-time so warm connections follow the current turn. */
  getInteractionState: () => { userResponse: 'stream' | 'message' | 'unavailable' }
  /** Live permission mode; read at fire-time so a warm-connection `reconcile` takes effect. */
  getPermissionMode: () => AgentPermissionMode | undefined
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
    // (1) disabledTools — block regardless of permission mode.
    if (ctx.isDisabled(toolName)) {
      return { block: true, reason: `Tool "${toolName}" is disabled for this agent.` }
    }

    const mode = ctx.getPermissionMode() ?? 'default'
    const approvalRequired = ctx.approvalRequiredTools.has(toolName)
    const bypass = mode === 'bypassPermissions' && !ctx.nonBypassableApprovalTools.has(toolName)

    // (2)/(3) bash-specific guards: block global installs, then rtk-rewrite in place. The rewrite
    // makes commands runnable and applies in every mode; the install block is a permission guard,
    // so an explicit bypass skips it.
    if (toolName === 'bash') {
      const command = typeof input.command === 'string' ? input.command : ''
      if (command.trim()) {
        const reason = bypass ? null : detectGlobalInstall(command)
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

    // (4) Full Access bypasses ordinary approval policy. Cross-Session delegation is the explicit
    // exception: its one-hop live-approval ceiling must hold in every permission mode.
    if (bypass) return

    // (5) approval by permission mode. Cherry-owned soul/autonomy tools are auto-approved in every
    // mode first (unattended heartbeat turns must not block on a renderer prompt). The disabledTools
    // block in (1) already ran, so a disabled soul tool stays hard-blocked — disabled beats auto-allow.
    if (ctx.autoApprovedTools.has(toolName) && !approvalRequired) return
    if (
      !(await requiresApproval(
        mode,
        toolName,
        input,
        ctx.workspacePath,
        ctx.agentDataPath,
        ctx.additionalReadOnlyRoots,
        approvalRequired
      ))
    )
      return

    const interactionState = ctx.getInteractionState()
    if (interactionState.userResponse === 'unavailable') {
      return {
        block: true,
        reason: approvalRequired
          ? 'This tool always requires user approval and cannot run unattended. Retry interactively.'
          : 'This unattended turn cannot request tool approval. Use bypassPermissions or retry interactively.'
      }
    }

    const approvalId = randomUUID()
    const presentation = interactionState.userResponse === 'stream' ? 'stream' : 'message'
    const resumeExecutionTimeout = onApprovalPending?.()
    let decision: DispatchDecision
    try {
      decision = await new Promise<DispatchDecision>((resolve) => {
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

    if (!decision.approved) {
      return { block: true, reason: decision.reason ?? 'User denied permission for this tool.' }
    }
    if (decision.updatedInput) applyInputEdit(input, decision.updatedInput)
    return
  }
}

/** Whether a tool must surface an approval request under the given mode. */
async function requiresApproval(
  mode: AgentPermissionMode,
  toolName: string,
  input: Record<string, unknown>,
  workspacePath: string,
  agentDataPath: string,
  additionalReadOnlyRoots: readonly string[],
  alwaysPrompt: boolean
): Promise<boolean> {
  if (alwaysPrompt) return true
  if (META_TOOLS.has(toolName)) return false
  // `auto` runs unattended and only stops for the two things a wrong call cannot undo: a file tool
  // reaching outside the allowed roots, and a shell command that looks destructive. Everything else
  // — including every MCP tool — goes through.
  //
  // The two halves are NOT equally strong. Path containment binds the file tools exactly; bash is
  // opaque to it, so `cat ../../secret` runs. The mode is convenience, not containment — it must
  // never be described to the user as a sandbox.
  if (mode === 'auto') {
    if (toolName === 'bash') {
      const command = typeof input.command === 'string' ? input.command : ''
      return detectDestructiveCommand(command) !== null
    }
    if (READ_ONLY_TOOLS.has(toolName)) {
      return !(await isToolPathInsideAllowedRoots(input, workspacePath, agentDataPath, true, additionalReadOnlyRoots))
    }
    if (EDIT_TOOLS.has(toolName)) {
      return !(await isToolPathInsideAllowedRoots(input, workspacePath, agentDataPath, true))
    }
    return false
  }
  // The read-only / acceptEdits fast-paths only skip approval when the tool's target path stays
  // inside an allowed root; any other read/write falls through to a normal prompt so a
  // prompt-injected model can't auto-touch ~/.ssh, Cherry's SQLite, ~/.zshrc, LaunchAgents, etc.
  if (READ_ONLY_TOOLS.has(toolName)) {
    return !(await isToolPathInsideAllowedRoots(input, workspacePath, agentDataPath, false, additionalReadOnlyRoots))
  }
  if (mode === 'acceptEdits' && EDIT_TOOLS.has(toolName)) {
    return !(await isToolPathInsideAllowedRoots(input, workspacePath, agentDataPath, true))
  }
  // `default` (and the unsupported-for-pi `plan`) gate everything else.
  return true
}

/**
 * Conservative containment check for the auto-approve fast-path. Reproduces the SECURITY-relevant
 * parts of pi's `resolveToCwd(path, cwd)` (see @earendil-works/pi-coding-agent path-utils): a
 * missing/empty `path` defaults to the workspace root, `~`/`~/…` expand to the home dir, a leading
 * `@` is stripped, absolute paths pass through, and everything else joins onto the workspace. Any
 * ambiguity (non-string path, `file://` URL, resolution failure) is treated as OUTSIDE so approval
 * is required. Existing targets and the workspace are canonicalized before comparison so a symlink
 * cannot make an outside target look lexically inside. For a new edit/write target, the nearest
 * existing parent is canonicalized and the missing suffix is appended for classification.
 */
async function isToolPathInsideAllowedRoots(
  input: Record<string, unknown>,
  workspacePath: string,
  agentDataPath: string,
  allowMissingTarget: boolean,
  additionalAllowedRoots: readonly string[] = []
): Promise<boolean> {
  const raw = input.path
  // read defaults a missing/empty path to "." → the workspace root, which is inside.
  if (raw !== undefined && raw !== null && typeof raw !== 'string') return false

  const resolved = resolveToolPath(raw || '.', workspacePath)
  if (resolved === undefined) return false

  const [canonicalWorkspace, canonicalAgentData, canonicalTarget] = await Promise.all([
    canonicalizeExistingPath(workspacePath),
    canonicalizeExistingPath(agentDataPath),
    canonicalizeToolTarget(resolved, allowMissingTarget)
  ])
  if (!canonicalWorkspace || !canonicalAgentData || !canonicalTarget) return false

  const canonicalAdditionalRoots = (
    await Promise.all(additionalAllowedRoots.map((root) => canonicalizeExistingPath(root)))
  ).filter((root): root is string => root !== undefined)

  return [canonicalWorkspace, canonicalAgentData, ...canonicalAdditionalRoots].some((root) => {
    const rel = path.relative(root, canonicalTarget)
    return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
  })
}

async function canonicalizeExistingPath(target: string): Promise<string | undefined> {
  try {
    return await realpath(target)
  } catch {
    return undefined
  }
}

async function canonicalizeToolTarget(target: string, allowMissing: boolean): Promise<string | undefined> {
  try {
    return await realpath(target)
  } catch (error) {
    if (!allowMissing || (error as NodeJS.ErrnoException).code !== 'ENOENT') return undefined
    // A dangling symlink exists but cannot be canonicalized; treat it as ambiguous, not as a new file.
    try {
      await lstat(target)
      return undefined
    } catch (statError) {
      if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') return undefined
    }
  }

  let parent = path.dirname(target)
  while (true) {
    try {
      const canonicalParent = await realpath(parent)
      return path.resolve(canonicalParent, path.relative(parent, target))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return undefined
      try {
        await lstat(parent)
        return undefined
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') return undefined
      }
      const next = path.dirname(parent)
      if (next === parent) return undefined
      parent = next
    }
  }
}

/** Resolve a raw tool `path` to an absolute path, mirroring pi's `resolveToCwd`; returns undefined
 *  for inputs whose resolution is ambiguous (e.g. `file://` URLs) so the caller requires approval. */
function resolveToolPath(raw: string, workspacePath: string): string | undefined {
  let p = raw.replace(UNICODE_SPACES, ' ')
  if (p.startsWith('@')) p = p.slice(1) // pi's stripAtPrefix
  if (p === '~') p = os.homedir()
  else if (p.startsWith('~/') || (process.platform === 'win32' && p.startsWith('~\\'))) {
    p = path.join(os.homedir(), p.slice(2))
  } else if (p.startsWith('file://')) {
    // pi resolves file:// via fileURLToPath; the target can be anywhere, so stay conservative.
    return undefined
  }
  return path.isAbsolute(p) ? path.resolve(p) : path.resolve(workspacePath, p)
}

/** Replace the tool input in place with the renderer's edited copy (pi mutates `event.input`). */
function applyInputEdit(input: Record<string, unknown>, updated: Record<string, unknown>): void {
  for (const key of Object.keys(input)) delete input[key]
  Object.assign(input, updated)
}
