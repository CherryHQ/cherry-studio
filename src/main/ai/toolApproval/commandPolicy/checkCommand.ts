import { t } from '@main/i18n'
import type { AgentPermissionMode } from '@shared/data/api/schemas/agents'
import type { CommandApprovalDetails } from '@shared/data/types/uiParts'

import type { CommandDialect } from './commandParser'
import { type CommandPolicyDecision, evaluateCommandPolicy } from './policyEvaluator'

export interface CommandCheckInput {
  command: string
  dialect: CommandDialect
  /** The invocation's working directory, shown on the approval card. */
  cwd?: string
  builtinRole?: string
  permissionMode: AgentPermissionMode | undefined
}

export interface CommandCheck {
  /**
   * `deny` blocks in every permission mode. `ask` requires a person for this one invocation and
   * only occurs in `auto`. `allow` means the policy adds no requirement; the mode's own rules apply.
   */
  effect: 'allow' | 'ask' | 'deny'
  /** Localized policy reason, present whenever a rule matched or analysis was incomplete. */
  reason?: string
  /** Approval-card evidence; the caller adds the reason that actually caused the prompt. */
  evidence: Omit<CommandApprovalDetails, 'reason'>
  /** Equal for two checks only when policy revision, dialect, cwd, role and permission mode match. */
  context: string
}

const MAX_CACHED_DECISIONS = 128
const decisions = new Map<string, Promise<CommandPolicyDecision>>()

/** Runtimes check one call several times (hook, permission callback, re-check after approval). */
function evaluate({ command, dialect, builtinRole }: CommandCheckInput): Promise<CommandPolicyDecision> {
  const key = JSON.stringify([command, dialect, builtinRole ?? null])
  const cached = decisions.get(key)
  if (cached) return cached
  const pending = evaluateCommandPolicy({ command, dialect, builtinRole }).then((decision) => {
    // A configuration failure has no rule hit; let the next call retry loading the parser.
    if (decision.effect === 'deny' && decision.hits.length === 0) decisions.delete(key)
    return decision
  })
  decisions.set(key, pending)
  if (decisions.size > MAX_CACHED_DECISIONS) decisions.delete(decisions.keys().next().value!)
  return pending
}

/** The only entry point for shell command consent: parse, match the bundled policy, apply the mode. */
export async function checkCommand(input: CommandCheckInput): Promise<CommandCheck> {
  const decision = await evaluate(input)
  return {
    effect: decision.effect === 'ask' && input.permissionMode !== 'auto' ? 'allow' : decision.effect,
    ...(decision.reason ? { reason: decision.reason } : {}),
    evidence: {
      ...(input.cwd ? { cwd: input.cwd } : {}),
      revision: decision.revision,
      rules: decision.hits.map(({ ruleId, reasonCode, evidence }) => ({ ruleId, reasonCode, evidence }))
    },
    context: JSON.stringify([
      decision.revision,
      input.dialect,
      input.cwd ?? null,
      input.builtinRole ?? null,
      input.permissionMode ?? null
    ])
  }
}

/** Reason for rejecting an approval whose command context changed while it was pending. */
export function commandContextChangedReason(): string {
  return t('command_approval.context_changed')
}
