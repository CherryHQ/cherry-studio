import { StringEnum, Type } from '@earendil-works/pi-ai'
import {
  type AgentBeforeSettleEvent,
  type AgentBeforeSettleEventResult,
  type AgentToolResult,
  buildSessionContext,
  convertToLlm,
  type ExtensionContext,
  type ExtensionFactory
} from '@earendil-works/pi-coding-agent'

import { ASK_USER_TOOL_NAME, type AskUserQuestionDetails } from './askUserExtension'
import {
  admitRound,
  assistantText,
  budgetExceeded,
  createGoal,
  currentGoal,
  editGoal,
  GOAL_NOTICE_TYPE,
  GOAL_ROUND_TYPE,
  GOAL_STATE_TYPE,
  type GoalBudget,
  GoalError,
  type GoalNotice,
  type GoalSnapshot,
  type GoalStopCode,
  goalView,
  isHumanTurn,
  isProgressResult,
  recordUsage,
  renderRoundPrompt,
  resumeGoal,
  type RoundDetails,
  stopGoal,
  tailRound,
  toolCallKey
} from './goalState'
import { type ConversationModelMessage, toModelMessages } from './modelMessages'

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
  /** Wired by the host integration (its ToolApprovalRegistry): approval events of this session's tool calls. */
  onApproval?(listener: (event: GoalApprovalEvent) => void): () => void
  /** L6: background subagents of this session still running; foreground subagents finish inside their call. */
  hasRunningSubagents?(): boolean
  verify?: GoalVerifier
}

export const GOAL_TOOL_NAMES = ['get_goal', 'create_goal', 'update_goal'] as const

const ACTIONS = ['edit', 'pause', 'resume', 'complete', 'blocked'] as const
const CONTROL_WORDS = new Set(['pause', 'resume', 'clear'])
const NUMBER = /^-?\d+(?:\.\d+)?$/
/** Rounds without progress before a hint round, and before the goal stops (spec §7.2). */
const HINT_AFTER_ROUNDS = 2
const STOP_AFTER_ROUNDS = 3
/** Identical calls in one round before they are blocked, and before the goal stops (spec §7.2). */
const BLOCK_REPEAT_AT = 3
const STOP_REPEAT_AT = 5

const text = (value: string) => ({ type: 'text' as const, text: value })
const hasText = (value: string | undefined): value is string => typeof value === 'string' && value.trim().length > 0
// 0 counts as omitted (weak models fill optional fields with it); negatives reach the limit checks.
const hasNumber = (value: number | undefined): value is number => value !== undefined && value !== 0

function statusText(goal: GoalSnapshot, armed: boolean): string {
  const stop = goal.lastStop
    ? ` (${goal.lastStop.code}${goal.lastStop.message ? ` — ${goal.lastStop.message}` : ''})`
    : ''
  return [
    `Goal: ${goal.objective}`,
    `Phase: ${goal.phase}${stop} · ${armed ? 'armed' : 'disarmed'}`,
    `Rounds: ${goal.roundsStarted}/${goal.maxGoalRounds} · Tokens: ${goal.tokensUsed}` +
      (goal.costUsed > 0 ? ` · Cost: $${goal.costUsed}` : '')
  ].join('\n')
}

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
  /** The turn(s) since the last admitted round belong to a goal round. */
  inGoalRound: boolean
  reservation: RoundDetails | undefined
  noProgressRounds: number
  /** The previous round's last text-bearing reply, normalized (spec §6.1). */
  previousText: string | undefined
  /** The current round so far: whether a call moved the objective, and its last text-bearing reply. */
  round: { toolProgress: boolean; text: string | undefined }
  repeat: { key: string | undefined; count: number }
  stopRequest: { code: GoalStopCode; message?: string } | undefined
  /** `count` consecutive goal rounds, the last one `round`, reported `blocked` (spec §7.5). */
  blocked: { round: number; count: number }
  /** Usage since the last snapshot write; folded into the next one. */
  pendingUsage: { tokens: number; usd: number }
  /** A goal round was admitted since the goal was last armed (spec §6.2 step 6). */
  roundAdmitted: boolean
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
      inGoalRound: false,
      reservation: undefined,
      noProgressRounds: 0,
      previousText: undefined,
      round: { toolProgress: false, text: undefined },
      repeat: { key: undefined, count: 0 },
      stopRequest: undefined,
      blocked: { round: 0, count: 0 },
      pendingUsage: { tokens: 0, usd: 0 },
      roundAdmitted: false
    }
    const limits = () => ({
      maxGoalRounds: port.defaults.maxGoalRounds,
      maxGoalRoundsCeiling: port.defaults.maxGoalRoundsCeiling,
      budget: port.defaults.budget
    })
    const now = () => Date.now()

    /** Per-goal runtime state starts over whenever the goal changes identity or re-arms. */
    const resetGoalRuntime = () => {
      runtime.pendingUsage = { tokens: 0, usd: 0 }
      runtime.reservation = undefined
      runtime.noProgressRounds = 0
      runtime.previousText = undefined
      runtime.round = { toolProgress: false, text: undefined }
      runtime.repeat = { key: undefined, count: 0 }
      runtime.stopRequest = undefined
      runtime.blocked = { round: 0, count: 0 }
      runtime.roundAdmitted = false
    }
    /** Every persisted change goes through here; pending usage rides along when it is the same goal's. */
    const commit = (next: GoalSnapshot) => {
      const withUsage = next.id === runtime.goal?.id ? recordUsage(next, runtime.pendingUsage, false) : next
      runtime.pendingUsage = { tokens: 0, usd: 0 }
      runtime.goal = withUsage
      pi.appendEntry(GOAL_STATE_TYPE, withUsage)
    }
    /** Spec §7.5: a user edit starts the blocked count over. */
    const commitEdit = (next: GoalSnapshot) => {
      commit(next)
      runtime.blocked = { round: 0, count: 0 }
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
      runtime.inGoalRound = false
      resetGoalRuntime()
    }
    const notice = (value: string, level: GoalNotice['level'] = 'info') =>
      pi.appendEntry(GOAL_NOTICE_TYPE, { text: value, level } satisfies GoalNotice)
    const create = (goal: GoalSnapshot) => {
      commit(goal)
      resetGoalRuntime()
      runtime.armed = true
      // A round still running belongs to the previous goal; the new one counts from its own first round.
      runtime.inGoalRound = false
    }
    /** Returns false when the goal already was paused. */
    const pause = (goal: GoalSnapshot): boolean => {
      if (goal.phase === 'complete') throw new GoalError('invalid_action', 'the goal is complete; create a new one')
      if (goal.phase === 'paused') return false
      stop('paused_by_user')
      return true
    }
    /** False when the goal already was active and armed; `resumeGoal` throws when it is complete or has no capacity. */
    const resume = (goal: GoalSnapshot): boolean => {
      const next = resumeGoal(goal, now())
      if (next === goal && runtime.armed) return false
      if (next !== goal) commit(next)
      resetGoalRuntime()
      runtime.armed = true
      return true
    }

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
    const requireHumanTurn = (ctx: ExtensionContext, what: string) => {
      if (!isHumanTurn(ctx.sessionManager.getBranch()))
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

    let unsubscribeApproval: (() => void) | undefined
    pi.on('session_start', (_event, ctx) => {
      runtime.goal = currentGoal(ctx.sessionManager.getBranch())
      runtime.armed = false
      runtime.inGoalRound = false
      unsubscribeApproval?.()
      unsubscribeApproval = port.onApproval?.((event) => {
        if (!runtime.goal || !runtime.inGoalRound) return
        if (event.kind === 'denied')
          runtime.stopRequest = { code: 'approval_denied', message: `tool call ${event.toolCallId} was denied` }
        if (event.kind === 'unavailable')
          runtime.stopRequest = {
            code: 'awaiting_approval',
            message: `tool call ${event.toolCallId} needs approval and nobody can give it`
          }
      })
    })
    pi.on('session_shutdown', () => {
      unsubscribeApproval?.()
      unsubscribeApproval = undefined
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
      execute: async () => ok()
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
      execute: async (_id, params, _signal, _onUpdate, ctx) => {
        requireHumanTurn(ctx, 'create_goal')
        if (runtime.goal && runtime.goal.phase !== 'complete')
          throw new GoalError('goal_exists', 'A goal is already set; edit, pause or clear it first.')
        create(
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
        return ok()
      }
    })

    pi.registerTool({
      name: 'update_goal',
      label: 'Update goal',
      description: 'Edit, pause, resume, complete or block the current goal. Copy goal_id and revision from get_goal.',
      parameters: updateParams,
      exposure: 'model-only',
      executionMode: 'sequential',
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      execute: async (_id, params, signal, _onUpdate, ctx) => {
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
            requireHumanTurn(ctx, 'edit')
            if (!extras)
              throw new GoalError(
                'invalid_action',
                'edit needs an objective, max_goal_rounds, budget_tokens or budget_usd'
              )
            commitEdit(
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
            requireHumanTurn(ctx, 'pause')
            pause(goal)
            return ok()
          case 'resume':
            requireHumanTurn(ctx, 'resume')
            resume(goal)
            return ok()
          case 'complete':
            return completeGoal(goal, params.evidence, signal, ctx)
          case 'blocked':
            return blockGoal(goal, params.blocked_reason, ctx)
        }
      }
    })

    /** The conversation as the session model would get it, for the host's verifier (spec §9). */
    const conversation = (ctx: ExtensionContext): ConversationModelMessage[] => {
      const { messages } = buildSessionContext(ctx.sessionManager.getEntries(), ctx.sessionManager.getLeafId())
      return toModelMessages(convertToLlm(messages), ctx.model!)
    }
    const completeGoal = async (
      goal: GoalSnapshot,
      evidence: string | undefined,
      signal: AbortSignal | undefined,
      ctx: ExtensionContext
    ) => {
      const claim: { evidence?: string } = hasText(evidence) ? { evidence: evidence.trim() } : {}
      if (port.verify) {
        let verdict: Awaited<ReturnType<GoalVerifier['verify']>>
        try {
          verdict = await port.verify.verify({
            objective: goal.objective,
            claim,
            messages: conversation(ctx),
            signal: signal ?? new AbortController().signal
          })
        } catch (error) {
          throw new GoalError(
            'invalid_action',
            `Completion could not be verified (${error instanceof Error ? error.message : String(error)}); keep working or report a blocker.`
          )
        }
        // A command may have edited, paused or cleared the goal while the verifier ran.
        requireRevision(goal.id, goal.revision)
        if (verdict.verdict === 'not_met') throw new GoalError('invalid_action', `Not complete yet: ${verdict.reason}`)
        if (verdict.verdict === 'impossible') stop('model_blocked', verdict.reason)
        else stop('complete')
        return ok()
      }
      if (!claim.evidence)
        throw new GoalError(
          'invalid_action',
          'complete needs evidence: name each deliverable and what proves it is done.'
        )
      if (goal.progressRounds === 0 && !(runtime.inGoalRound && roundProgressed()))
        throw new GoalError(
          'invalid_action',
          'No round of this goal changed anything yet; do the work before marking it complete.'
        )
      stop('complete')
      return ok()
    }
    const blockGoal = (goal: GoalSnapshot, reason: string | undefined, ctx: ExtensionContext) => {
      if (!hasText(reason))
        throw new GoalError('invalid_action', 'blocked needs blocked_reason: the concrete condition that persisted.')
      // Spec §7.5: in a human turn a person is there to resume; a goal round needs consecutive reports.
      if (!isHumanTurn(ctx.sessionManager.getBranch())) {
        const round = goal.roundsStarted
        if (runtime.blocked.round !== round)
          runtime.blocked = { round, count: runtime.blocked.round === round - 1 ? runtime.blocked.count + 1 : 1 }
        const { count } = runtime.blocked
        const needed = port.defaults.blockedAfter
        if (count < needed)
          throw new GoalError(
            'invalid_action',
            `Keep trying; if the same condition still blocks you in round ${round + needed - count}, report it again (${count}/${needed}).`
          )
      }
      stop('model_blocked', reason.trim())
      return ok()
    }

    const roundMessage = (goal: GoalSnapshot, details: RoundDetails) => ({
      customType: GOAL_ROUND_TYPE,
      content: renderRoundPrompt(goal, details, port.defaults.blockedAfter, runtime.noProgressRounds),
      display: false,
      details
    })
    /** Spec §6.2 step 10: the last allowed round, or the first after the budget is crossed, is a wrap-up. */
    const reserve = (goal: GoalSnapshot): RoundDetails => {
      const kind =
        goal.roundsStarted + 1 >= goal.maxGoalRounds || budgetExceeded(goal)
          ? 'wrap-up'
          : runtime.noProgressRounds === HINT_AFTER_ROUNDS
            ? 'hint'
            : 'work'
      runtime.reservation = { goalId: goal.id, revision: goal.revision, round: goal.roundsStarted + 1, kind }
      return runtime.reservation
    }
    /** Spec §6.0: a command that arms the goal on an idle session starts the first round itself. */
    const startRound = (ctx: ExtensionContext) => {
      if (!runtime.goal || !runtime.armed || !ctx.isIdle()) return
      pi.sendMessage(roundMessage(runtime.goal, reserve(runtime.goal)), { triggerTurn: true })
    }
    /** Spec §6.3: a reserved round counts once Pi sends its message on. */
    const admit = (details: RoundDetails | undefined) => {
      const reserved = runtime.reservation
      if (!runtime.goal || !reserved || !details) return
      if (
        details.goalId !== reserved.goalId ||
        details.revision !== reserved.revision ||
        details.round !== reserved.round
      )
        return
      runtime.reservation = undefined
      runtime.inGoalRound = true
      runtime.roundAdmitted = true
      runtime.round = { toolProgress: false, text: undefined }
      runtime.repeat = { key: undefined, count: 0 }
      commit(admitRound(runtime.goal, reserved.kind, now()))
    }
    const roundProgressed = () =>
      runtime.round.toolProgress || (runtime.round.text !== undefined && runtime.round.text !== runtime.previousText)
    /** Spec §6.1, §7.2: a round ends at the settle or when a person speaks; any progressing turn counts for it. */
    const closeRound = () => {
      if (!runtime.inGoalRound || !runtime.goal) return
      runtime.inGoalRound = false
      const progressed = roundProgressed()
      if (runtime.round.text !== undefined) runtime.previousText = runtime.round.text
      runtime.noProgressRounds = progressed ? 0 : runtime.noProgressRounds + 1
      if (progressed) runtime.goal = recordUsage(runtime.goal, { tokens: 0, usd: 0 }, true)
    }
    /** Spec §6.1: a person's message ends the goal round and starts the streaks over. */
    const startHumanTurn = () => {
      closeRound()
      runtime.noProgressRounds = 0
      runtime.blocked = { round: 0, count: 0 }
    }
    const lastErrorMessage = (ctx: ExtensionContext) => {
      const last = ctx.sessionManager.getBranch().at(-1)
      return last?.type === 'message' && last.message.role === 'assistant' ? last.message.errorMessage : undefined
    }

    /** Spec §6.2, in order; `undefined` lets the run settle. */
    const decide = (event: AgentBeforeSettleEvent, ctx: ExtensionContext): AgentBeforeSettleEventResult | undefined => {
      const goal = runtime.goal
      if (event.outcome === 'error') {
        if (goal?.phase === 'active' && runtime.armed) stop('provider_error', lastErrorMessage(ctx))
        return undefined
      }
      if (!goal || goal.phase !== 'active') return undefined
      if (runtime.stopRequest) {
        const { code, message } = runtime.stopRequest
        runtime.stopRequest = undefined
        stop(code, message)
        return undefined
      }
      if (!runtime.armed) return undefined
      if (runtime.roundAdmitted && port.defaults.autonomy() === 'confirm-each-round') {
        stop('paused_each_round')
        return undefined
      }
      if (event.context.pendingMessages.length > 0) return undefined
      if (port.hasRunningSubagents?.() === true) {
        stop('waiting_subagents')
        return undefined
      }
      if (runtime.noProgressRounds >= STOP_AFTER_ROUNDS) {
        stop('no_progress')
        return undefined
      }
      if (goal.wrapUpDone) {
        stop(goal.roundsStarted >= goal.maxGoalRounds ? 'round_limit' : 'budget_exhausted')
        return undefined
      }
      // The budget check sees this round's usage; the next snapshot write folds it in.
      const projected = recordUsage(goal, runtime.pendingUsage, false)
      return { entries: [{ type: 'custom_message', ...roundMessage(projected, reserve(projected)) }], continue: true }
    }

    // A round the settle committed is on the branch when its run starts; Pi emits no message_end for it.
    pi.on('turn_start', (_event, ctx) => admit(tailRound(ctx.sessionManager.getBranch())))
    pi.on('message_end', (event) => {
      const { message } = event
      if (message.role === 'user') startHumanTurn()
      // A round a command sent: its message_end comes after turn_start, before Pi persists it.
      else if (message.role === 'custom' && message.customType === GOAL_ROUND_TYPE)
        admit(message.details as RoundDetails)
    })

    pi.on('tool_call', (event) => {
      if (!runtime.goal || !runtime.inGoalRound || event.parentToolCallId !== undefined) return undefined
      const key = toolCallKey(event.toolName, event.input)
      const count = runtime.repeat.key === key ? runtime.repeat.count + 1 : 1
      runtime.repeat = { key, count }
      if (count < BLOCK_REPEAT_AT) return undefined
      if (count >= STOP_REPEAT_AT)
        runtime.stopRequest = {
          code: 'no_progress',
          message: `the same ${event.toolName} call was repeated ${count} times`
        }
      return {
        block: true,
        reason:
          'The same call has already been executed in this round and its result will not change; change approach or report the concrete blocker.',
        terminate: count >= STOP_REPEAT_AT
      }
    })

    pi.on('turn_end', (event) => {
      if (!runtime.goal || !runtime.inGoalRound || event.message.role !== 'assistant') return
      const { usage } = event.message
      runtime.pendingUsage.tokens += usage.input + usage.output + usage.cacheRead + usage.cacheWrite
      runtime.pendingUsage.usd += usage.cost.total
      for (const result of event.toolResults) {
        // A tool's own usage (a subagent's requests) counts too: the host billed it, the budget has not seen it.
        if (result.usage) {
          runtime.pendingUsage.tokens += result.usage.totalTokens
          runtime.pendingUsage.usd += result.usage.cost.total
        }
        if (isProgressResult(result)) runtime.round.toolProgress = true
        // Stored sessions and thrown calls carry no `outcome`.
        if (
          result.toolName === ASK_USER_TOOL_NAME &&
          (result.details as Partial<Pick<AskUserQuestionDetails, 'outcome'>> | undefined)?.outcome === 'declined'
        )
          runtime.stopRequest = { code: 'needs_user_input', message: 'the user dismissed the question' }
      }
      const reply = assistantText(event.message)
      // A reply cut off by the output limit shows nothing about progress (spec §7.2).
      if (reply && event.message.stopReason !== 'length') runtime.round.text = reply
    })

    pi.on('agent_before_settle', (event, ctx) => {
      closeRound()
      return decide(event, ctx)
    })

    pi.on('agent_settled', (event) => {
      const rejected = runtime.reservation !== undefined
      runtime.reservation = undefined
      runtime.inGoalRound = false
      if (runtime.goal?.phase !== 'active') return
      // Pi skips agent_before_settle after session.abort(); the abort surfaces only here. An unarmed
      // goal is not running, so aborting an unrelated turn leaves it alone.
      if (event.aborted) {
        if (runtime.armed) stop('aborted')
      } else if (rejected) stop('continuation_rejected')
    })

    pi.registerCommand('goal', {
      description:
        'Set or manage the session goal: [<objective> | edit <objective> | pause | resume | clear | rounds <n> | budget <tokens|$usd>]',
      handler: async (args, ctx) => {
        const input = args.trim()
        try {
          if (input === '') {
            notice(
              runtime.goal
                ? statusText(runtime.goal, runtime.armed)
                : 'No goal is set. Use /goal <objective> to create one.'
            )
            return
          }
          const word = input.split(/\s+/, 1)[0]
          const keyword = word.toLowerCase()
          const value = input.slice(word.length).trim()
          if (CONTROL_WORDS.has(keyword) && value === '') {
            const goal = requireGoal()
            // A goal that is not active drives no turn, so a running turn is the human's to keep.
            const stopTurn = () => {
              if (goal.phase === 'active' && !ctx.isIdle()) ctx.abort()
            }
            if (keyword === 'pause') {
              if (pause(goal)) {
                stopTurn()
                notice('Goal paused.')
              } else notice('Goal is already paused.')
            } else if (keyword === 'clear') {
              clear()
              stopTurn()
              notice('Goal cleared.')
            } else if (resume(goal)) {
              notice('Goal resumed.')
              startRound(ctx)
            } else notice('Goal is already active.')
            return
          }
          // With no goal to edit, a leading "edit" followed by text is part of a new objective.
          if (keyword === 'edit' && (runtime.goal || value === '')) {
            commitEdit(editGoal(requireGoal(), { objective: value }, port.defaults.maxGoalRoundsCeiling, now()))
            notice('Goal objective updated.')
            return
          }
          if (keyword === 'rounds' && NUMBER.test(value)) {
            commitEdit(
              editGoal(requireGoal(), { maxGoalRounds: Number(value) }, port.defaults.maxGoalRoundsCeiling, now())
            )
            notice(`Round cap set to ${runtime.goal!.maxGoalRounds}.`)
            return
          }
          if (keyword === 'budget' && NUMBER.test(value.replace(/^\$/, ''))) {
            const budget = value.startsWith('$') ? { usd: Number(value.slice(1)) } : { tokens: Number(value) }
            commitEdit(editGoal(requireGoal(), { budget }, port.defaults.maxGoalRoundsCeiling, now()))
            notice('Budget updated.')
            return
          }
          if (runtime.goal && runtime.goal.phase !== 'complete')
            throw new GoalError(
              'goal_exists',
              'A goal is already set; use /goal edit, /goal pause or /goal clear first.'
            )
          create(createGoal(input, limits(), {}, now()))
          notice('Goal created.')
          startRound(ctx)
        } catch (error) {
          notice(error instanceof Error ? error.message : String(error), 'error')
        }
      }
    })
  }
}
