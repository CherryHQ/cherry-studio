import { useCallback, useEffect, useState } from 'react'

import { getPermissionModeCards } from '@renderer/utils/agent'
import { BUILTIN_AGENT_ROLE } from '@shared/ai/builtinAgent'
import type { AgentEntity } from '@shared/data/types/agent'

/** English triggers match as whole words ("make a plan" is covered by "plan"); CJK has no word boundaries. */
const PLAN_INTENT_PATTERN = /\b(?:plan|planning|make a plan)\b|计划|规划|做个计划|先规划/i

export const hasPlanIntent = (text: string): boolean => PLAN_INTENT_PATTERN.test(text)

export const canOfferPlanMode = (agent: Pick<AgentEntity, 'type' | 'configuration'> | undefined): boolean => {
  if (!agent || agent.configuration?.builtin_role === BUILTIN_AGENT_ROLE.ASSISTANT) return false
  if ((agent.configuration?.permission_mode ?? 'default') === 'plan') return false
  return getPermissionModeCards(agent.type).some((card) => card.mode === 'plan')
}

type HintStatus = 'idle' | 'visible' | 'done'

/**
 * Tracks the Plan Mode hint for one message draft: it shows at most once, then stays gone
 * (accepted, dismissed, or trigger deleted) until `resetDraft` starts a new draft.
 */
export function usePlanModeHint({
  agent,
  text,
  enablePlanMode
}: {
  agent: Pick<AgentEntity, 'type' | 'configuration'> | undefined
  text: string
  enablePlanMode: () => void
}) {
  const [status, setStatus] = useState<HintStatus>('idle')
  const eligible = canOfferPlanMode(agent)
  const triggered = hasPlanIntent(text)

  useEffect(() => {
    if (status === 'idle' && eligible && triggered) setStatus('visible')
    else if (status === 'visible' && !(eligible && triggered)) setStatus('done')
  }, [eligible, status, triggered])

  const dismiss = useCallback(() => setStatus('done'), [])
  const accept = useCallback(() => {
    enablePlanMode()
    setStatus('done')
  }, [enablePlanMode])
  const resetDraft = useCallback(() => setStatus('idle'), [])

  return { visible: status === 'visible' && eligible && triggered, accept, dismiss, resetDraft }
}
