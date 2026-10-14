import { randomUUID } from 'node:crypto'

import { StringEnum, Type } from '@earendil-works/pi-ai'
import {
  type AgentBeforeSettleEvent,
  type AgentBeforeSettleEventResult,
  type AgentToolResult,
  buildSessionContext,
  convertToLlm,
  type CustomMessageEntryDraft,
  type ExtensionContext,
  type ExtensionFactory,
  type SessionBoundaryDraft,
  type SessionEntry
} from '@earendil-works/pi-coding-agent'

import { ASK_USER_TOOL_NAME, type AskUserQuestionDetails } from './askUserExtension'
import {
  admitRound,
  assistantText,
  budgetExceeded,
  createGoal,
  currentGoal,
  editGoal,
  GOAL_COMPLETE_MESSAGE,
  GOAL_NOTICE_TYPE,
  GOAL_ROUND_TYPE,
  GOAL_STATE_TYPE,
  type GoalBudget,
  GoalError,
  type GoalNotice,
  type GoalSnapshot,
  type GoalStopCode,
  goalSubagents,
  type GoalUsage,
  goalUsage,
  goalView,
  isHumanTurn,
  isProgressResult,
  renderRoundPrompt,
  resumeGoal,
  type RoundDetails,
  stopGoal,
  tailRound,
  toolCallKey,
  unadmittedRounds,
  withUsage
} from './goalState'
import { type ConversationModelMessage, toModelMessages } from './modelMessages'
import type { ToolApprovalEvent } from './ports'
import { isSubagentSession, SUBAGENT_GOAL_LINK, type SubagentGoalLink } from './subagent'
import { SUBAGENT_NOTIFICATION_TYPE } from './subagentDelivery'

/** Host-side completion check; without it the extension falls back to runtime checks (spec §9). */
export interface GoalVerifier {
  verify(input: {
    objective: string
    claim: { evidence?: string }
    /**
     * The session's whole context after compaction (not cut), after the session model's replay rules,
     * shaped like the compaction summarizer's input.
     */
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
  /**
   * Wired by the host integration (its ToolApprovalRegistry): approval events of this session's
   * tool calls. Events of other calls (a subagent's) are ignored.
   */
  onApproval?(listener: (event: ToolApprovalEvent) => void): () => void
  verify?: GoalVerifier
}

export const GOAL_TOOL_NAMES = ['get_goal', 'create_goal', 'update_goal'] as const

const ACTIONS = ['edit', 'pause', 'resume', 'complete', 'blocked'] as const
const CONTROL_WORDS = new Set(['pause', 'resume', 'clear'])
const NUMBER = /^-?\d+(?:\.\d+)?$/
/** Rounds without progress before a hint round, and before the goal stops (spec §7.2). */
const HINT_AFTER_ROUNDS = 2
const STOP_AFTER_ROUNDS = 3
/** Identical calls in a row within one round before they are blocked, and before the goal stops (spec §7.2). */
const BLOCK_REPEAT_AT = 3
const STOP_REPEAT_AT = 5
const BUDGET_REFUSAL = "The goal's budget is used up; background subagents cannot be started."

/** Sent after the goal view when a completion is accepted (spec §7.5). */
const COMPLETE_INSTRUCTION =
  'The goal is complete. End your turn with a short summary for the user of what was delivered and how it was checked; do not start new work.'

const text = (value: string) => ({ type: 'text' as const, text: value })
const hasText = (value: string | undefined): value is string => typeof value === 'string' && value.trim().length > 0
// 0 counts as omitted (weak models fill optional fields with it); negatives reach the limit checks.
const hasNumber = (value: number | undefined): value is number => value !== undefined && value !== 0

function statusText(goal: GoalSnapshot, usage: GoalUsage, waitingFor: number): string {
  const stop = goal.lastStop
    ? ` (${goal.lastStop.code}${goal.lastStop.message ? ` — ${goal.lastStop.message}` : ''})`
    : ''
  return [
    `Goal: ${goal.objective}`,
    `Phase: ${goal.phase}${stop} · ${goal.armed ? 'armed' : 'disarmed'}`,
    `Rounds: ${goal.roundsStarted}/${goal.maxGoalRounds} · Tokens: ${usage.tokens}` +
      (usage.usd > 0 ? ` · Cost: $${usage.usd.toFixed(4)}` : ''),
    ...(goal.phase === 'active' && waitingFor > 0
      ? [`Waiting for ${waitingFor} background subagent${waitingFor === 1 ? '' : 's'}`]
      : [])
  ].join('\n')
}

type ContextMessage = ReturnType<typeof buildSessionContext>['messages'][number]

/** `messages` without the round messages Pi committed but never sent on (spec §6.3); the same list when there are none. */
function withoutUnadmittedRounds(messages: ContextMessage[], ctx: ExtensionContext): ContextMessage[] {
  const stale = unadmittedRounds(ctx.sessionManager.getBranch())
  if (stale.size === 0) return messages
  return messages.filter(
    (message) =>
      message.role !== 'custom' ||
      message.customType !== GOAL_ROUND_TYPE ||
      !stale.has((message.details as RoundDetails).id)
  )
}

const isNotificationDraft = (draft: SessionBoundaryDraft): draft is CustomMessageEntryDraft =>
  draft.type === 'custom_message' && draft.customType === SUBAGENT_NOTIFICATION_TYPE

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
  /** The branch's current goal, plus progress the next snapshot records (`unsaved`). */
  goal: GoalSnapshot | undefined
  unsaved: boolean
  /** The turn(s) since the last admitted round belong to a goal round. */
  inGoalRound: boolean
  reservation: RoundDetails | undefined
  /** A reserved round was withdrawn before its request: the goal changed while the settle finished. */
  withdrawn: boolean
  noProgressRounds: number
  /** The previous round's last text-bearing reply, normalized (spec §6.1). */
  previousText: string | undefined
  /** The current round so far: whether a call moved the objective, and its last text-bearing reply. */
  round: { toolProgress: boolean; text: string | undefined }
  repeat: { key: string | undefined; count: number }
  stopRequest: { code: GoalStopCode; message?: string } | undefined
  /** `count` consecutive goal rounds, the last one `round`, reported `blocked` (spec §7.5). */
  blocked: { round: number; count: number }
  /** A goal round was admitted since the goal was last armed (spec §6.2 step 6). */
  roundAdmitted: boolean
  /** This is a subagent's session: the goal belongs to the main agent (spec §8.4). */
  inSubagent: boolean
  /** Tool calls of this session executing now; approval events of other calls are not the goal's. */
  ownCalls: Set<string>
}

/**
 * The goal extension: a persisted objective the runtime keeps pushing while the model is idle,
 * with every stop decided here (spec §1). Host-facing behavior comes in through `port`.
 */
export function createGoalExtension(port: GoalPort): ExtensionFactory {
  return (pi) => {
    // Spec §6.3: Pi commits a round before it knows whether the run goes on; one that never ran stays out of requests.
    pi.on('context', (event, ctx) => {
      const messages = withoutUnadmittedRounds(event.messages, ctx)
      return messages === event.messages ? undefined : { messages }
    })
    if (!port.modelSupportsTools()) {
      // Spec §8.3: no tools and no command; an active goal on the branch records why nothing continues.
      pi.on('session_start', (_event, ctx) => {
        const goal = currentGoal(ctx.sessionManager.getBranch())
        if (goal?.phase === 'active')
          pi.appendEntry(
            GOAL_STATE_TYPE,
            stopGoal(goal, { code: 'unsupported_model', message: 'the current model has no tool calling' }, Date.now())
          )
      })
      return
    }

    const runtime: Runtime = {
      goal: undefined,
      unsaved: false,
      inGoalRound: false,
      reservation: undefined,
      withdrawn: false,
      noProgressRounds: 0,
      previousText: undefined,
      round: { toolProgress: false, text: undefined },
      repeat: { key: undefined, count: 0 },
      stopRequest: undefined,
      blocked: { round: 0, count: 0 },
      roundAdmitted: false,
      inSubagent: false,
      ownCalls: new Set()
    }
    let subagents: SubagentGoalLink | undefined
    pi.events.on(SUBAGENT_GOAL_LINK, (link) => {
      subagents = link as SubagentGoalLink
    })
    let branch: () => readonly SessionEntry[] = () => []
    /** Spec §6.1: always read from the branch, never kept. */
    const usage = (): GoalUsage => (runtime.goal ? goalUsage(branch(), runtime.goal.id) : { tokens: 0, usd: 0 })
    const limits = () => ({
      maxGoalRounds: port.defaults.maxGoalRounds,
      maxGoalRoundsCeiling: port.defaults.maxGoalRoundsCeiling,
      budget: port.defaults.budget
    })
    const now = () => Date.now()

    /** Per-goal runtime state starts over whenever the goal changes identity or re-arms. */
    const usedUp = () => runtime.goal !== undefined && budgetExceeded(runtime.goal, usage())
    const resetGoalRuntime = () => {
      runtime.reservation = undefined
      runtime.noProgressRounds = 0
      runtime.previousText = undefined
      runtime.round = { toolProgress: false, text: undefined }
      runtime.repeat = { key: undefined, count: 0 }
      runtime.stopRequest = undefined
      runtime.blocked = { round: 0, count: 0 }
      runtime.roundAdmitted = false
    }
    /** Every persisted change goes through here; the snapshot records the usage the branch shows now. */
    const commit = (next: GoalSnapshot) => {
      runtime.goal = withUsage(next, goalUsage(branch(), next.id))
      runtime.unsaved = false
      pi.appendEntry(GOAL_STATE_TYPE, runtime.goal)
    }
    /** Spec §7.5: a user edit starts the blocked count over. */
    const commitEdit = (next: GoalSnapshot) => {
      commit(next)
      runtime.blocked = { round: 0, count: 0 }
    }
    /** A stop mid-round ends that round: its progress so far is in the stop's snapshot (spec §6.1). */
    const stop = (code: GoalStopCode, message?: string) => {
      if (!runtime.goal) return
      closeRound()
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
      runtime.unsaved = false
      resetGoalRuntime()
    }
    const notice = (value: string, level: GoalNotice['level'] = 'info') =>
      pi.appendEntry(GOAL_NOTICE_TYPE, { text: value, level } satisfies GoalNotice)
    const create = (goal: GoalSnapshot) => {
      commit(goal)
      resetGoalRuntime()
      // A round still running belongs to the previous goal; the new one counts from its own first round.
      runtime.inGoalRound = false
    }
    /** Returns false when the goal already was paused. */
    const pause = (goal: GoalSnapshot): boolean => {
      if (goal.phase === 'complete') throw new GoalError('invalid_action', GOAL_COMPLETE_MESSAGE)
      if (goal.phase === 'paused') return false
      stop('paused_by_user')
      return true
    }
    /** False when the goal already was active and armed; `resumeGoal` throws when it is complete or has no capacity. */
    const resume = (goal: GoalSnapshot): boolean => {
      const next = resumeGoal(goal, now(), usage())
      if (next === goal) return false
      commit(next)
      resetGoalRuntime()
      return true
    }

    const requireMainAgent = () => {
      if (runtime.inSubagent)
        throw new GoalError(
          'in_subagent',
          'Goals belong to the main agent; a subagent cannot read or change them. Finish the task you were given and report back.'
        )
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
          `Stale goal reference; current view: ${JSON.stringify(goalView(goal, usage()))}`
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
      content: [text(JSON.stringify(goalView(runtime.goal, usage())))],
      details: undefined
    })

    let unsubscribeApproval: (() => void) | undefined
    pi.on('session_start', (_event, ctx) => {
      const entries = ctx.sessionManager.getBranch()
      runtime.inSubagent = isSubagentSession(entries)
      // A fork inherits the parent's goal entries; the goal stays the parent's, so this session has none.
      if (runtime.inSubagent) return
      // The manager, not `ctx`: Pi invalidates `ctx` at shutdown, and the goal view stays readable.
      const { sessionManager } = ctx
      branch = () => sessionManager.getBranch()
      runtime.goal = currentGoal(entries)
      runtime.inGoalRound = false
      // A restored goal starts disarmed, and the branch must say so for what it counts (spec §6.1).
      if (runtime.goal?.armed) commit({ ...runtime.goal, armed: false })
      subagents?.guardBackground(() =>
        runtime.goal?.phase === 'active' && runtime.goal.armed && usedUp() ? BUDGET_REFUSAL : undefined
      )
      unsubscribeApproval = port.onApproval?.((event) => {
        // The host's registry also reports the subagents' calls; only this session's are the goal's.
        if (!runtime.goal || !runtime.inGoalRound || !runtime.ownCalls.has(event.toolCallId)) return
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
      execute: async () => {
        requireMainAgent()
        return ok()
      }
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
        requireMainAgent()
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
        requireMainAgent()
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
        if ((params.action === 'complete' || params.action === 'blocked') && goal.phase === 'complete')
          throw new GoalError('invalid_action', GOAL_COMPLETE_MESSAGE)
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
                now(),
                usage()
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
      return toModelMessages(convertToLlm(withoutUnadmittedRounds(messages, ctx)), ctx.model!)
    }
    const finishGoal = (): AgentToolResult<unknown> => {
      stop('complete')
      const { content } = ok()
      return { content: [...content, text(COMPLETE_INSTRUCTION)], details: undefined }
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
        if (verdict.verdict === 'met') return finishGoal()
        stop('model_blocked', verdict.reason)
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
      return finishGoal()
    }
    const blockGoal = (goal: GoalSnapshot, reason: string | undefined, ctx: ExtensionContext) => {
      if (!hasText(reason))
        throw new GoalError('invalid_action', 'blocked needs blocked_reason: the concrete condition that persisted.')
      // Spec §8.1: a goal that is already blocked stays as it is.
      if (goal.phase === 'blocked') return ok()
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
        goal.roundsStarted + 1 >= goal.maxGoalRounds || budgetExceeded(goal, usage())
          ? 'wrap-up'
          : runtime.noProgressRounds === HINT_AFTER_ROUNDS
            ? 'hint'
            : 'work'
      runtime.reservation = {
        id: randomUUID(),
        goalId: goal.id,
        revision: goal.revision,
        round: goal.roundsStarted + 1,
        kind
      }
      return runtime.reservation
    }
    /** Spec §6.0: a command that arms the goal on an idle session starts the first round itself. */
    const startRound = (ctx: ExtensionContext) => {
      if (runtime.goal?.phase !== 'active' || !runtime.goal.armed || !ctx.isIdle()) return
      pi.sendMessage(roundMessage(runtime.goal, reserve(runtime.goal)), { triggerTurn: true })
    }
    /** The goal is still the one the round was reserved for, with room for it. */
    const stillReserved = (goal: GoalSnapshot, reserved: RoundDetails) =>
      goal.id === reserved.goalId &&
      goal.revision === reserved.revision &&
      goal.phase === 'active' &&
      goal.armed &&
      reserved.round === goal.roundsStarted + 1 &&
      reserved.round <= goal.maxGoalRounds &&
      (reserved.kind === 'wrap-up' || !budgetExceeded(goal, usage()))
    /** Spec §6.3: a reserved round counts once Pi sends its message on, if it is still valid then. */
    const admit = (details: RoundDetails | undefined, ctx: ExtensionContext) => {
      const reserved = runtime.reservation
      if (!runtime.goal || !reserved || details?.id !== reserved.id) return
      runtime.reservation = undefined
      // A command changed the goal while a later settle handler ran: the round must not reach the model.
      if (!stillReserved(runtime.goal, reserved)) {
        runtime.withdrawn = true
        ctx.abort()
        return
      }
      runtime.inGoalRound = true
      runtime.roundAdmitted = true
      runtime.round = { toolProgress: false, text: undefined }
      runtime.repeat = { key: undefined, count: 0 }
      commit(admitRound(runtime.goal, reserved, now()))
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
      if (!progressed) return
      runtime.goal = { ...runtime.goal, progressRounds: runtime.goal.progressRounds + 1 }
      runtime.unsaved = true
    }
    /** Spec §6.1: a person's message ends the goal round and starts the streaks over. */
    const startHumanTurn = () => {
      closeRound()
      runtime.noProgressRounds = 0
      runtime.blocked = { round: 0, count: 0 }
    }
    const lastErrorMessage = (ctx: ExtensionContext) => {
      // Other extensions' entries may follow the failed reply.
      const last = ctx.sessionManager.getBranch().findLast((entry) => entry.type === 'message')
      return last?.type === 'message' && last.message.role === 'assistant' ? last.message.errorMessage : undefined
    }

    /** Spec §6.2, in order; `undefined` lets the run settle. */
    const decide = (event: AgentBeforeSettleEvent, ctx: ExtensionContext): AgentBeforeSettleEventResult | undefined => {
      const goal = runtime.goal
      if (event.outcome === 'error') {
        if (goal?.phase === 'active' && goal.armed) stop('provider_error', lastErrorMessage(ctx))
        return undefined
      }
      if (!goal || goal.phase !== 'active') return undefined
      // Spec §11.2: one start per request; the notification's turn settles first, then the goal decides.
      if (event.entries.some(isNotificationDraft)) return undefined
      if (runtime.stopRequest) {
        const { code, message } = runtime.stopRequest
        runtime.stopRequest = undefined
        stop(code, message)
        return undefined
      }
      if (!goal.armed) return undefined
      if (runtime.roundAdmitted && port.defaults.autonomy() === 'confirm-each-round') {
        stop('paused_each_round')
        return undefined
      }
      // Pi continues for a queued user message, not for an extension message that starts no turn.
      if (event.context.pendingMessages.some((message) => message.role === 'user')) return undefined
      // Spec §11.4: the goal's own background subagents stop with its budget.
      if (usedUp()) subagents?.stopForBudget(goalSubagents(branch(), goal.id))
      if (runtime.noProgressRounds >= STOP_AFTER_ROUNDS) {
        stop('no_progress')
        return undefined
      }
      // A cap lowered to the running round leaves no room for a wrap-up either.
      if (goal.wrapUpDone || goal.roundsStarted >= goal.maxGoalRounds) {
        stop(goal.roundsStarted >= goal.maxGoalRounds ? 'round_limit' : 'budget_exhausted')
        return undefined
      }
      // Spec §11.1: background subagents still at work; their notification starts the next turn.
      if ((subagents?.running() ?? 0) > 0) return undefined
      const round = { type: 'custom_message' as const, ...roundMessage(goal, reserve(goal)) }
      // Pi keeps only the last handler's entries, so carry what earlier extensions proposed.
      return { entries: [...event.entries, round], continue: true }
    }

    // A round the settle committed is on the branch when its run starts; Pi emits no message_end for it.
    pi.on('turn_start', (_event, ctx) => admit(tailRound(ctx.sessionManager.getBranch()), ctx))
    pi.on('message_end', (event, ctx) => {
      const { message } = event
      if (message.role === 'user') startHumanTurn()
      // A round a command sent: its message_end comes after turn_start, before Pi persists it.
      else if (message.role === 'custom' && message.customType === GOAL_ROUND_TYPE)
        admit(message.details as RoundDetails, ctx)
    })
    pi.on('tool_execution_start', (event) => void runtime.ownCalls.add(event.toolCallId))
    pi.on('tool_execution_end', (event) => void runtime.ownCalls.delete(event.toolCallId))

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
      for (const result of event.toolResults) {
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
      if (runtime.inSubagent) return undefined
      // A request the host aborted through its own signal settles here; agent_settled reports aborted: false.
      if (event.outcome === 'aborted') {
        runtime.inGoalRound = false
        if (runtime.goal?.phase === 'active' && runtime.goal.armed) stop('aborted')
        return undefined
      }
      closeRound()
      const result = decide(event, ctx)
      // Progress of a round no snapshot records otherwise (the run yields to a queued user message).
      if (runtime.unsaved && !runtime.reservation) commit(runtime.goal!)
      return result
    })

    pi.on('agent_settled', (event, ctx) => {
      const rejected = runtime.reservation !== undefined
      const { withdrawn } = runtime
      runtime.reservation = undefined
      runtime.withdrawn = false
      runtime.inGoalRound = false
      const goal = runtime.goal
      if (goal?.phase !== 'active') return
      if (withdrawn) {
        // Our own abort, before the withdrawn round's request: go on as the goal is now (spec §6.3).
        if (!goal.armed) return
        if (goal.wrapUpDone || goal.roundsStarted >= goal.maxGoalRounds)
          stop(goal.roundsStarted >= goal.maxGoalRounds ? 'round_limit' : 'budget_exhausted')
        else startRound(ctx)
        return
      }
      // Pi skips agent_before_settle after session.abort(); the abort surfaces only here. An unarmed
      // goal is not running, so aborting an unrelated turn leaves it alone.
      if (event.aborted) {
        if (goal.armed) stop('aborted')
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
                ? statusText(runtime.goal, usage(), subagents?.running() ?? 0)
                : 'No goal is set. Use /goal <objective> to create one.'
            )
            return
          }
          const word = input.split(/\s+/, 1)[0]
          const keyword = word.toLowerCase()
          const value = input.slice(word.length).trim()
          if (CONTROL_WORDS.has(keyword) && value === '') {
            const goal = requireGoal()
            // Only an active, armed goal drives the running turn; otherwise the turn is the human's to keep.
            const drivesTurn = goal.phase === 'active' && goal.armed
            const stopTurn = () => {
              if (drivesTurn && !ctx.isIdle()) ctx.abort()
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
            commitEdit(
              editGoal(requireGoal(), { objective: value }, port.defaults.maxGoalRoundsCeiling, now(), usage())
            )
            notice('Goal objective updated.')
            return
          }
          if (keyword === 'rounds' && NUMBER.test(value)) {
            commitEdit(
              editGoal(
                requireGoal(),
                { maxGoalRounds: Number(value) },
                port.defaults.maxGoalRoundsCeiling,
                now(),
                usage()
              )
            )
            notice(`Round cap set to ${runtime.goal!.maxGoalRounds}.`)
            return
          }
          if (keyword === 'budget' && NUMBER.test(value.replace(/^\$/, ''))) {
            const budget = value.startsWith('$') ? { usd: Number(value.slice(1)) } : { tokens: Number(value) }
            commitEdit(editGoal(requireGoal(), { budget }, port.defaults.maxGoalRoundsCeiling, now(), usage()))
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
