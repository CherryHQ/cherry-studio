import type { AgentSession } from '@earendil-works/pi-coding-agent'

type PiAgent = AgentSession['agent']
type PiFinishTurn = NonNullable<PiAgent['finishTurn']>
type PiTurnContext = Parameters<PiFinishTurn>[0]
type PiTurnDecision = Awaited<ReturnType<PiFinishTurn>>

export interface PiRoundBudget {
  /** Completed tool-calling rounds observed in the current run. */
  readonly rounds: number
  /** Start a new run: the budget counts completed rounds per prompt run, not per session. */
  reset: () => void
}

/**
 * Round budget for the SDK's agent loop, wired through the agent-level `finishTurn` hook - the same
 * runtime surface the session's own turn-boundary wrapper chains and honors an "end" decision from
 * (agent-session.js _installAgentBoundaryHooks). The extension-level `turn_end` BoundaryResult can
 * only FORCE a continuation, never veto one, so the budget cannot live in the approval extension.
 *
 * Semantics, mirroring Cherry's AI-SDK path which maps maxToolCalls to stepCountIs(20) (#23189):
 * - Only tool-calling rounds count; a final text-only answer turn completes normally at any count.
 * - After `limit` completed tool rounds the run ends via { action: "end" } - no abort, so every
 *   admitted in-flight tool call has already settled and its result is in context.
 * - Aborted and errored responses stay the SDK's hard exits and are never relabeled as the limit.
 * - A prior "end" decision (e.g. from the session boundary chain) always wins; a prior "continue"
 *   is honored until the budget is exhausted, then the budget - the safety backstop - wins.
 *
 * Session-queue interaction: an "end" decision skips the agent loop's own steering/follow-up
 * queue poll for the final round; messages queued during that round stay in the SDK queues rather
 * than being delivered to a turn that no longer exists. Delivery is the session layer's business
 * (continuation drain or next-run poll, depending on timing) and Cherry's connection keeps its own
 * safety net: steers it redirected that the SDK never surfaced are re-queued via the existing
 * steer-undelivered path when the prompt run settles. The budget therefore spans the whole prompt
 * lifecycle (reset happens only when the next user prompt starts), so a session continuation that
 * keeps calling tools force-ends after one further round; the limit callback can fire again there
 * and MUST stay idempotent. Cherry's wiring is idempotent: the callback sets a boolean that
 * finishPromptRun reports once, when the whole prompt lifecycle settles.
 */
export function installPiRoundBudget(agent: PiAgent, limit: number, onLimitReached: () => void): PiRoundBudget {
  let rounds = 0
  const previous = agent.finishTurn
  agent.finishTurn = async (turn: PiTurnContext, signal?: AbortSignal): Promise<PiTurnDecision> => {
    const decision = (await previous?.(turn, signal)) ?? undefined
    if (signal?.aborted) return decision
    if (decision?.action === 'end') return decision
    if (turn.toolResults.length > 0) {
      rounds += 1
      if (rounds >= limit) {
        onLimitReached()
        return { action: 'end' } as const
      }
    }
    return decision
  }
  return {
    get rounds() {
      return rounds
    },
    reset: () => {
      rounds = 0
    }
  }
}
