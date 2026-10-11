import { randomUUID } from 'node:crypto'

export const GOAL_STATE_TYPE = 'cherry.goal'
export const GOAL_ROUND_TYPE = 'cherry.goal-round'
/** Feedback of a `/goal` command for the UI; never sent to the model. */
export const GOAL_NOTICE_TYPE = 'cherry.goal-notice'
export const MAX_OBJECTIVE_CHARS = 4000

export type GoalPhase = 'active' | 'paused' | 'blocked' | 'complete'

export type GoalStopCode =
  | 'complete'
  | 'model_blocked'
  | 'round_limit'
  | 'budget_exhausted'
  | 'no_progress'
  | 'approval_denied'
  | 'awaiting_approval'
  | 'needs_user_input'
  | 'waiting_children'
  | 'provider_error'
  | 'aborted'
  | 'paused_by_user'
  | 'paused_each_round'
  | 'continuation_rejected'
  | 'unsupported_model'

export interface GoalBudget {
  tokens?: number
  usd?: number
}

export interface GoalStop {
  code: GoalStopCode
  message?: string
  at: number
}

export interface GoalSnapshot {
  id: string
  revision: number
  objective: string
  phase: GoalPhase
  roundsStarted: number
  /** Rounds in which a non-read tool call succeeded or the reply changed; the fallback completion check reads it. */
  progressRounds: number
  maxGoalRounds: number
  budget?: GoalBudget
  tokensUsed: number
  costUsed: number
  wrapUpDone: boolean
  lastStop?: GoalStop
  createdAt: number
  updatedAt: number
}

export type GoalCleared = { id: string; revision: number; cleared: true; at: number }

export interface GoalLimits {
  maxGoalRounds: number
  maxGoalRoundsCeiling: number
  budget?: GoalBudget
}

export type GoalErrorCode =
  | 'invalid_objective'
  | 'invalid_limit'
  | 'stale_revision'
  | 'no_goal'
  | 'goal_exists'
  | 'not_human_turn'
  | 'no_capacity'
  | 'invalid_action'

export class GoalError extends Error {
  constructor(
    readonly code: GoalErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'GoalError'
  }
}

const PAUSED_CODES = new Set<GoalStopCode>(['aborted', 'paused_by_user', 'paused_each_round'])

export function phaseForStop(code: GoalStopCode): GoalPhase {
  if (code === 'complete') return 'complete'
  return PAUSED_CODES.has(code) ? 'paused' : 'blocked'
}

function checkObjective(objective: string): string {
  const trimmed = objective.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_OBJECTIVE_CHARS)
    throw new GoalError('invalid_objective', `objective must be 1-${MAX_OBJECTIVE_CHARS} characters`)
  return trimmed
}

function checkCap(cap: number, ceiling: number): number {
  if (!Number.isInteger(cap) || cap < 1 || cap > ceiling)
    throw new GoalError('invalid_limit', `max_goal_rounds must be an integer between 1 and ${ceiling}`)
  return cap
}

function checkBudget(budget: GoalBudget | undefined): GoalBudget | undefined {
  if (!budget) return undefined
  for (const value of [budget.tokens, budget.usd])
    if (value !== undefined && !(Number.isFinite(value) && value > 0))
      throw new GoalError('invalid_limit', 'budget values must be positive numbers')
  return budget.tokens === undefined && budget.usd === undefined ? undefined : budget
}

const bump = (goal: GoalSnapshot, now: number, patch: Partial<GoalSnapshot>): GoalSnapshot => ({
  ...goal,
  ...patch,
  revision: goal.revision + 1,
  updatedAt: now
})

export function createGoal(
  objective: string,
  limits: GoalLimits,
  overrides: { maxGoalRounds?: number; budget?: GoalBudget },
  now: number
): GoalSnapshot {
  const budget = checkBudget(overrides.budget ?? limits.budget)
  return {
    id: randomUUID(),
    revision: 1,
    objective: checkObjective(objective),
    phase: 'active',
    roundsStarted: 0,
    progressRounds: 0,
    maxGoalRounds: checkCap(overrides.maxGoalRounds ?? limits.maxGoalRounds, limits.maxGoalRoundsCeiling),
    ...(budget ? { budget } : {}),
    tokensUsed: 0,
    costUsed: 0,
    wrapUpDone: false,
    createdAt: now,
    updatedAt: now
  }
}

export function budgetExceeded(goal: GoalSnapshot): boolean {
  const { budget } = goal
  if (!budget) return false
  return (
    (budget.tokens !== undefined && goal.tokensUsed >= budget.tokens) ||
    (budget.usd !== undefined && goal.costUsed >= budget.usd)
  )
}

export function hasCapacity(goal: GoalSnapshot): boolean {
  return goal.roundsStarted < goal.maxGoalRounds && !budgetExceeded(goal)
}

/** Raising a limit re-opens a goal the limit closed; the caller still has to resume (arm) it. */
export function editGoal(
  goal: GoalSnapshot,
  patch: { objective?: string; maxGoalRounds?: number; budget?: GoalBudget },
  ceiling: number,
  now: number
): GoalSnapshot {
  const next: Partial<GoalSnapshot> = {}
  if (patch.objective !== undefined) next.objective = checkObjective(patch.objective)
  if (patch.maxGoalRounds !== undefined) next.maxGoalRounds = checkCap(patch.maxGoalRounds, ceiling)
  if (patch.budget !== undefined) next.budget = checkBudget({ ...goal.budget, ...patch.budget })
  const edited = bump(goal, now, next)
  const raised =
    edited.maxGoalRounds > goal.maxGoalRounds ||
    (goal.budget !== undefined && !budgetExceeded(edited) && budgetExceeded(goal))
  if (!raised) return edited
  const closedByLimit =
    goal.phase === 'blocked' && (goal.lastStop?.code === 'round_limit' || goal.lastStop?.code === 'budget_exhausted')
  return { ...edited, wrapUpDone: false, ...(closedByLimit ? { phase: 'active' as const } : {}) }
}

export function stopGoal(
  goal: GoalSnapshot,
  stop: { code: GoalStopCode; message?: string },
  now: number
): GoalSnapshot {
  return bump(goal, now, { phase: phaseForStop(stop.code), lastStop: { ...stop, at: now } })
}

export function resumeGoal(goal: GoalSnapshot, now: number): GoalSnapshot {
  if (goal.phase === 'complete') throw new GoalError('invalid_action', 'the goal is complete; create a new one')
  if (!hasCapacity(goal)) throw new GoalError('no_capacity', 'raise max_goal_rounds or the budget before resuming')
  return goal.phase === 'active' ? goal : bump(goal, now, { phase: 'active' })
}

export function admitRound(goal: GoalSnapshot, kind: 'work' | 'hint' | 'wrap-up', now: number): GoalSnapshot {
  return bump(goal, now, { roundsStarted: goal.roundsStarted + 1, ...(kind === 'wrap-up' ? { wrapUpDone: true } : {}) })
}

/** Usage of one goal round; no revision bump, the next snapshot carries it. */
export function recordUsage(
  goal: GoalSnapshot,
  usage: { tokens: number; usd: number },
  progressed: boolean
): GoalSnapshot {
  return {
    ...goal,
    tokensUsed: goal.tokensUsed + usage.tokens,
    costUsed: goal.costUsed + usage.usd,
    progressRounds: goal.progressRounds + (progressed ? 1 : 0)
  }
}
