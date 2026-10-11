import { StringEnum, Type } from '@earendil-works/pi-ai'
import {
  type AgentToolResult,
  type ExtensionContext,
  type ExtensionFactory,
  type SessionEntry
} from '@earendil-works/pi-coding-agent'

import {
  createGoal,
  currentGoal,
  editGoal,
  GOAL_NOTICE_TYPE,
  GOAL_STATE_TYPE,
  type GoalBudget,
  GoalError,
  type GoalSnapshot,
  type GoalStopCode,
  goalView,
  isHumanTurn,
  recordUsage,
  resumeGoal,
  type RoundDetails,
  stopGoal
} from './goalState'
import type { ConversationModelMessage } from './modelMessages'

export interface GoalApprovalEvent {
  kind: 'pending' | 'granted' | 'denied' | 'unavailable'
  toolCallId: string
}

/** Host-side completion check; without it the extension falls back to runtime checks (spec §9). */
export interface GoalVerifier {
  verify(input: {
    objective: string
    claim: { evidence?: string }
    /** Recent conversation after the session model's replay rules, like the compaction summarizer's input. */
    messages: ConversationModelMessage[]
    signal: AbortSignal
  }): Promise<{ verdict: 'met' | 'not_met' | 'impossible'; reason: string }>
}

export interface GoalPort {
  defaults: {
    maxGoalRounds: number
    maxGoalRoundsCeiling: number
    budget?: GoalBudget
    blockedAfter: number
    /** Read at every decision, so the host may change it while a goal runs. */
    autonomy: () => 'auto' | 'confirm-each-round'
  }
  modelSupportsTools(): boolean
  /** L4: approval events of this session's tool calls. */
  onApproval?(listener: (event: GoalApprovalEvent) => void): () => void
  /** L4: background subagents of this session still running. */
  hasRunningChildren?(): boolean
  verify?: GoalVerifier
}

export const GOAL_TOOL_NAMES = ['get_goal', 'create_goal', 'update_goal'] as const

const ACTIONS = ['edit', 'pause', 'resume', 'complete', 'blocked'] as const
const CONTROL_WORDS = new Set(['pause', 'resume', 'clear'])

const text = (value: string) => ({ type: 'text' as const, text: value })
const hasText = (value: string | undefined): value is string => typeof value === 'string' && value.trim().length > 0
const hasNumber = (value: number | undefined): value is number => typeof value === 'number' && value > 0

const createParams = Type.Object({
  objective: Type.String({ description: 'The concrete completion objective from the direct human request.' }),
  max_goal_rounds: Type.Optional(Type.Number({ description: 'Round cap for this goal; omit for the default.' })),
  budget_tokens: Type.Optional(Type.Number({ description: 'Token budget for this goal; omit for none.' })),
  budget_usd: Type.Optional(Type.Number({ description: 'Cost budget in USD for this goal; omit for none.' }))
})

const updateParams = Type.Object({
  goal_id: Type.String({ description: 'Exact id from a prior get_goal.' }),
  revision: Type.Number({ description: 'Exact revision from a prior get_goal.' }),
  action: StringEnum(ACTIONS, {
    description:
      'edit | pause | resume | complete | blocked. complete only when the objective is achieved; blocked only after the same condition persisted for the configured consecutive rounds.'
  }),
  objective: Type.Optional(Type.String({ description: 'Replacement objective; valid only with action edit.' })),
  max_goal_rounds: Type.Optional(Type.Number({ description: 'New round cap; valid only with action edit.' })),
  budget_tokens: Type.Optional(Type.Number({ description: 'New token budget; valid only with action edit.' })),
  budget_usd: Type.Optional(Type.Number({ description: 'New USD budget; valid only with action edit.' })),
  blocked_reason: Type.Optional(
    Type.String({ description: 'The concrete blocking condition; required with action blocked.' })
  ),
  evidence: Type.Optional(
    Type.String({ description: 'What proves each deliverable is done; required with action complete.' })
  )
})

interface Runtime {
  goal: GoalSnapshot | undefined
  armed: boolean
  ctx: ExtensionContext | undefined
  /** The turn(s) since the last admitted round belong to a goal round. */
  inGoalRound: boolean
  reservation: RoundDetails | undefined
  noProgressRounds: number
  previousText: string | undefined
  repeat: { key: string | undefined; count: number }
  stopRequest: { code: GoalStopCode; message?: string } | undefined
  blockedRounds: { revision: number; rounds: Set<number> }
  /** Usage since the last snapshot write; folded into the next one. */
  pendingUsage: { tokens: number; usd: number }
  /** Whether any turn of the current round progressed; undefined until its first turn ends. */
  lastRoundProgressed: boolean | undefined
}

/**
 * The goal extension: a persisted objective the runtime keeps pushing while the model is idle,
 * with every stop decided here (spec §1). Host-facing behavior comes in through `port`.
 */
export function createGoalExtension(port: GoalPort): ExtensionFactory {
  return (pi) => {
    if (!port.modelSupportsTools()) return

    const runtime: Runtime = {
      goal: undefined,
      armed: false,
      ctx: undefined,
      inGoalRound: false,
      reservation: undefined,
      noProgressRounds: 0,
      previousText: undefined,
      repeat: { key: undefined, count: 0 },
      stopRequest: undefined,
      blockedRounds: { revision: 0, rounds: new Set() },
      pendingUsage: { tokens: 0, usd: 0 },
      lastRoundProgressed: undefined
    }
    const limits = () => ({
      maxGoalRounds: port.defaults.maxGoalRounds,
      maxGoalRoundsCeiling: port.defaults.maxGoalRoundsCeiling,
      budget: port.defaults.budget
    })
    const now = () => Date.now()
    const branch = (): SessionEntry[] => runtime.ctx?.sessionManager.getBranch() ?? []

    /** Every persisted change goes through here; pending usage rides along. */
    const commit = (next: GoalSnapshot) => {
      const withUsage = recordUsage(next, runtime.pendingUsage, false)
      runtime.pendingUsage = { tokens: 0, usd: 0 }
      runtime.goal = withUsage
      pi.appendEntry(GOAL_STATE_TYPE, withUsage)
    }
    const stop = (code: GoalStopCode, message?: string) => {
      if (!runtime.goal) return
      runtime.armed = false
      commit(stopGoal(runtime.goal, { code, message }, now()))
    }
    const clear = () => {
      if (!runtime.goal) return
      pi.appendEntry(GOAL_STATE_TYPE, {
        id: runtime.goal.id,
        revision: runtime.goal.revision + 1,
        cleared: true,
        at: now()
      })
      runtime.goal = undefined
      runtime.armed = false
    }
    const notice = (value: string, level: 'info' | 'error' = 'info') =>
      pi.appendEntry(GOAL_NOTICE_TYPE, { text: value, level })

    const requireGoal = (): GoalSnapshot => {
      if (!runtime.goal) throw new GoalError('no_goal', 'No goal is set.')
      return runtime.goal
    }
    const requireRevision = (goalId: string, revision: number): GoalSnapshot => {
      const goal = requireGoal()
      if (goal.id !== goalId || goal.revision !== revision)
        throw new GoalError(
          'stale_revision',
          `Stale goal reference; current view: ${JSON.stringify(goalView(goal, runtime.armed))}`
        )
      return goal
    }
    const requireHumanTurn = (what: string) => {
      if (!isHumanTurn(branch()))
        throw new GoalError('not_human_turn', `${what} needs a direct human request in this turn.`)
    }
    const budgetFrom = (params: { budget_tokens?: number; budget_usd?: number }): GoalBudget | undefined => {
      const budget: GoalBudget = {}
      if (hasNumber(params.budget_tokens)) budget.tokens = params.budget_tokens
      if (hasNumber(params.budget_usd)) budget.usd = params.budget_usd
      return budget.tokens === undefined && budget.usd === undefined ? undefined : budget
    }
    const ok = (): AgentToolResult<unknown> => ({
      content: [text(JSON.stringify(goalView(runtime.goal, runtime.armed)))],
      details: undefined
    })
    const fail = (error: unknown): AgentToolResult<unknown> => ({
      content: [text(error instanceof Error ? error.message : String(error))],
      details: undefined,
      isError: true
    })
    const guarded = (run: () => AgentToolResult<unknown> | Promise<AgentToolResult<unknown>>) => async () => {
      try {
        return await run()
      } catch (error) {
        return fail(error)
      }
    }

    pi.on('session_start', (_event, ctx) => {
      runtime.ctx = ctx
      runtime.goal = currentGoal(ctx.sessionManager.getBranch())
      runtime.armed = false
      runtime.inGoalRound = false
    })

    pi.registerTool({
      name: 'get_goal',
      label: 'Goal',
      description:
        'Read the current goal, or { goal: null } when none is set. Call it before update_goal and copy its id and revision.',
      parameters: Type.Object({}),
      exposure: 'model-only',
      executionMode: 'sequential',
      annotations: { readOnlyHint: true, openWorldHint: false },
      execute: guarded(() => ok())
    })

    pi.registerTool({
      name: 'create_goal',
      label: 'Create goal',
      description:
        'Create a persisted goal that keeps this session working across automatic rounds. Only for a long-running objective the user asked for directly; not for single-turn work.',
      parameters: createParams,
      exposure: 'model-only',
      executionMode: 'sequential',
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      execute: (_id, params) =>
        guarded(() => {
          requireHumanTurn('create_goal')
          if (runtime.goal && runtime.goal.phase !== 'complete')
            throw new GoalError('goal_exists', 'A goal is already set; edit, pause or clear it first.')
          commit(
            createGoal(
              params.objective,
              limits(),
              {
                maxGoalRounds: hasNumber(params.max_goal_rounds) ? params.max_goal_rounds : undefined,
                budget: budgetFrom(params)
              },
              now()
            )
          )
          runtime.armed = true
          return ok()
        })()
    })

    pi.registerTool({
      name: 'update_goal',
      label: 'Update goal',
      description: 'Edit, pause, resume, complete or block the current goal. Copy goal_id and revision from get_goal.',
      parameters: updateParams,
      exposure: 'model-only',
      executionMode: 'sequential',
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      execute: (_id, params, signal) =>
        guarded(async () => {
          const goal = requireRevision(params.goal_id, params.revision)
          const extras =
            hasText(params.objective) ||
            hasNumber(params.max_goal_rounds) ||
            hasNumber(params.budget_tokens) ||
            hasNumber(params.budget_usd)
          if (params.action !== 'edit' && extras)
            throw new GoalError('invalid_action', 'objective and limits are valid only with action edit')
          if (params.action !== 'blocked' && hasText(params.blocked_reason))
            throw new GoalError('invalid_action', 'blocked_reason is valid only with action blocked')
          switch (params.action) {
            case 'edit':
              requireHumanTurn('edit')
              commit(
                editGoal(
                  goal,
                  {
                    objective: hasText(params.objective) ? params.objective : undefined,
                    maxGoalRounds: hasNumber(params.max_goal_rounds) ? params.max_goal_rounds : undefined,
                    budget: budgetFrom(params)
                  },
                  port.defaults.maxGoalRoundsCeiling,
                  now()
                )
              )
              return ok()
            case 'pause':
              requireHumanTurn('pause')
              stop('paused_by_user')
              return ok()
            case 'resume':
              requireHumanTurn('resume')
              commit(resumeGoal(goal, now()))
              runtime.armed = true
              return ok()
            case 'complete':
              return completeGoal(goal, params.evidence, signal)
            case 'blocked':
              return blockGoal(goal, params.blocked_reason)
          }
        })()
    })

    // Tasks 5–9 fill these in; the skeleton keeps the model-facing contract compilable.
    const completeGoal = async (goal: GoalSnapshot, evidence: string | undefined, _signal: AbortSignal | undefined) => {
      void goal
      void evidence
      void _signal
      throw new GoalError('invalid_action', 'complete is not available yet')
    }
    const blockGoal = (goal: GoalSnapshot, reason: string | undefined) => {
      void goal
      void reason
      throw new GoalError('invalid_action', 'blocked is not available yet')
    }

    pi.registerCommand('goal', {
      description:
        'Set or manage the session goal: [<objective> | edit <objective> | pause | resume | clear | rounds <n> | budget <tokens|$usd>]',
      handler: async (args, ctx) => {
        runtime.ctx = ctx
        const input = args.trim()
        try {
          if (input === '') {
            notice(
              runtime.goal
                ? `Goal: ${JSON.stringify(goalView(runtime.goal, runtime.armed))}`
                : 'No goal is set. Use /goal <objective> to create one.'
            )
            return
          }
          if (CONTROL_WORDS.has(input)) {
            const goal = requireGoal()
            if (input === 'pause') {
              stop('paused_by_user')
              if (!ctx.isIdle()) ctx.abort()
              notice('Goal paused.')
            } else if (input === 'clear') {
              clear()
              if (!ctx.isIdle()) ctx.abort()
              notice('Goal cleared.')
            } else {
              commit(resumeGoal(goal, now()))
              runtime.armed = true
              notice('Goal resumed.')
              // Task 5 starts the first round from here when the agent is idle.
            }
            return
          }
          const [word, ...rest] = input.split(/\s+/)
          const value = rest.join(' ')
          if (word === 'edit') {
            commit(editGoal(requireGoal(), { objective: value }, port.defaults.maxGoalRoundsCeiling, now()))
            notice('Goal objective updated.')
            return
          }
          if (word === 'rounds') {
            commit(editGoal(requireGoal(), { maxGoalRounds: Number(value) }, port.defaults.maxGoalRoundsCeiling, now()))
            notice(`Round cap set to ${runtime.goal!.maxGoalRounds}.`)
            return
          }
          if (word === 'budget') {
            const budget = value.startsWith('$') ? { usd: Number(value.slice(1)) } : { tokens: Number(value) }
            commit(editGoal(requireGoal(), { budget }, port.defaults.maxGoalRoundsCeiling, now()))
            notice('Budget updated.')
            return
          }
          if (runtime.goal && runtime.goal.phase !== 'complete')
            throw new GoalError(
              'goal_exists',
              'A goal is already set; use /goal edit, /goal pause or /goal clear first.'
            )
          commit(createGoal(input, limits(), {}, now()))
          runtime.armed = true
          notice('Goal created.')
          // Task 5 starts the first round from here when the agent is idle.
        } catch (error) {
          notice(error instanceof Error ? error.message : String(error), 'error')
        }
      }
    })
  }
}
