import { detectGlobalInstall } from '../dependencyGuard'
import { detectDestructiveCommand } from '../destructiveCommand'
import { evaluateToolGuards, type ToolGuardContext } from '../toolGuards'
import {
  foldDecisions,
  HEADLESS_ASK_DENIAL,
  type PermissionCall,
  type PermissionContext,
  type PermissionDecision
} from '../types'
import { isPathWithinRoots } from './paths'

function presentation(context: PermissionContext): 'stream' | 'message' {
  return context.responder === 'stream' && !context.delegated ? 'stream' : 'message'
}

function ask(context: PermissionContext, reason: string, ruleId: string): PermissionDecision {
  return { effect: 'ask', reason, ruleId, presentation: presentation(context) }
}

function deny(reason: string, ruleId: string): PermissionDecision {
  return { effect: 'deny', reason, ruleId }
}

function isConductTag(call: PermissionCall, tag: NonNullable<PermissionCall['conductTags']>[number]): boolean {
  return call.conductTags?.includes(tag) ?? false
}

function hasPermanentDelete(call: PermissionCall): boolean {
  // Generic shell destructiveness is the `auto` usability rule, not the built-in Agent conduct
  // contract. Adapters must tag the product-level fact so an unrelated command (for example
  // `npm publish`) cannot be mistaken for permanent data deletion.
  return isConductTag(call, 'permanent-delete')
}

function evaluateProductConduct(call: PermissionCall, context: PermissionContext): PermissionDecision | undefined {
  if (context.builtinRole && hasPermanentDelete(call)) {
    return deny(
      'This built-in Agent blocked a permanently destructive operation. Use the structured trash flow for confirmed workspace deletions.',
      'builtin-destructive'
    )
  }

  if (context.builtinRole === 'assistant' && isConductTag(call, 'feedback-submission')) {
    return ask(
      context,
      'Submitting Cherry Studio feedback externally requires live per-call user approval.',
      'assistant-feedback'
    )
  }

  if (context.builtinRole === 'support' && call.category === 'shell') {
    return ask(context, 'Cherry Support shell commands require live per-call user approval.', 'support-bash')
  }

  if (context.turn === 'headless' && isConductTag(call, 'agent-config-mutation')) {
    return deny(
      'Headless channel or scheduled turns cannot mutate agent configuration. Ask the user to make this change in Cherry Studio.',
      'headless-config-mutation'
    )
  }

  return undefined
}

function toGuardContext(call: PermissionCall, context: PermissionContext): ToolGuardContext {
  const inherited =
    typeof context.guardContext === 'object' && context.guardContext !== null
      ? (context.guardContext as Partial<ToolGuardContext>)
      : {}
  return {
    ...inherited,
    toolName: call.toolName,
    input: inherited.input,
    permissionMode: context.mode,
    builtinRole: context.builtinRole,
    mountedServers: inherited.mountedServers ?? new Set<string>(),
    pluginDirectories: inherited.pluginDirectories ?? new Map<string, string>(),
    cwd: context.roots.workspace,
    agentDataPath: context.roots.agentData,
    interaction: {
      currentTurn: context.turn,
      userResponse: context.responder
    },
    isDisabled: context.isDisabled,
    log: context.log
  }
}

function finalize(decision: PermissionDecision, context: PermissionContext): PermissionDecision {
  if (decision.effect !== 'ask' || context.responder !== 'unavailable') return decision
  return deny(HEADLESS_ASK_DENIAL, decision.ruleId ?? 'headless-ask')
}

/**
 * Evaluate the shared permission matrix. Adapters classify and extract structured facts; this
 * function owns ordering and is intentionally independent of runtime-specific tool schemas.
 */
export async function evaluatePermission(
  call: PermissionCall,
  context: PermissionContext
): Promise<PermissionDecision> {
  const decisions: PermissionDecision[] = []

  // 1. Disabled tools are a hard limit in every mode.
  if (context.isDisabled(call.toolName))
    decisions.push(deny(`The ${call.toolName} tool is disabled for this agent.`, 'disabled-tool'))

  // 2. Global installs mutate state shared by agents and are never bypassable.
  if (call.category === 'shell' && call.command) {
    const reason = detectGlobalInstall(call.command)
    if (reason) decisions.push(deny(`Blocked to avoid cross-agent dependency pollution: ${reason}.`, 'global-install'))
  }

  // 3. Product conduct rules and same-process runtime-local guards run before ordinary mode rules.
  const conduct = evaluateProductConduct(call, context)
  if (conduct) decisions.push(conduct)
  if (context.guardRules?.length) {
    const guard = await evaluateToolGuards(context.guardRules, toGuardContext(call, context))
    if (guard) {
      decisions.push(
        guard.effect === 'deny' ? deny(guard.reason, guard.ruleId) : ask(context, guard.reason, guard.ruleId)
      )
    }
  }

  // 4. These categories always need a live decision.
  if (call.category === 'non-bypassable' || call.category === 'requires-user') {
    decisions.push(ask(context, 'This tool requires live per-call user approval.', call.category))
  }

  const folded = foldDecisions(decisions)
  if (folded.effect !== 'allow') return finalize(folded, context)

  // 5-7. Full Access still stops at the hard limits above.
  if (context.mode === 'full') return { effect: 'allow' }
  if (call.category === 'safe-first-party' || call.category === 'meta') return { effect: 'allow' }
  if (call.category === 'sensitive-first-party') {
    return finalize(
      ask(context, 'This sensitive first-party tool requires per-call approval.', 'sensitive-first-party'),
      context
    )
  }

  // 8-9. Structured file paths are checked only after the adapter has classified the call.
  const pathsInsideRoots = async (allowMissingTarget: boolean): Promise<boolean> =>
    call.paths !== undefined &&
    call.paths.length > 0 &&
    (await Promise.all(call.paths.map((path) => isPathWithinRoots(context.roots, path, allowMissingTarget)))).every(
      Boolean
    )
  if (call.category === 'read') {
    if (await pathsInsideRoots(false)) return { effect: 'allow' }
    return finalize(
      ask(
        context,
        'The requested read path is outside the trusted workspace and Agent data roots.',
        'workspace-escape'
      ),
      context
    )
  }
  if (call.category === 'edit') {
    if (
      (context.mode === 'edit' || context.mode === 'auto') &&
      (await pathsInsideRoots(call.allowMissingTarget ?? true))
    ) {
      return { effect: 'allow' }
    }
    return finalize(
      ask(
        context,
        'This edit requires approval because it is outside the trusted roots or the current mode does not allow edits.',
        'edit-approval'
      ),
      context
    )
  }

  // 10. Auto is deterministic, with destructive shell calls returned to the user.
  if (context.mode === 'auto') {
    if (call.category === 'shell' && call.command && detectDestructiveCommand(call.command)) {
      return finalize(
        ask(context, 'This shell command looks destructive and needs approval.', 'destructive-command'),
        context
      )
    }
    if (call.category === 'shell' || call.category === 'ordinary') return { effect: 'allow' }
  }

  // 11. Unknown or ordinary mode/category combinations ask.
  return finalize(ask(context, 'This operation requires approval.', 'permission-required'), context)
}
