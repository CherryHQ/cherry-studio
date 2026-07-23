import { stepCountIs, type StepResult, type StopCondition, type ToolSet } from 'ai'

import { getTrustedLocalToolTerminalFailure, type TerminalToolFailure } from './localToolTerminalOutcome'

export type { TerminalToolFailure } from './localToolTerminalOutcome'

type ToolLoopStopWhen = StopCondition<ToolSet> | Array<StopCondition<ToolSet>> | undefined

type ToolLoopTerminationInput = {
  steps: Array<StepResult<ToolSet>>
  stopWhen: ToolLoopStopWhen
}

type TrackedStopReason = 'steer-yield' | 'tool-call-limit'

type TrackedStopState = {
  reason: TrackedStopReason
  /** The exact SDK step on which this condition returned true. */
  step: StepResult<ToolSet> | undefined
}

const trackedStopConditions = new WeakMap<StopCondition<ToolSet>, TrackedStopState>()

const TOOL_CALL_LIMIT_MESSAGE =
  'The assistant reached the tool-call limit before producing a final answer. Try again or reduce the task scope.'

function trackStopCondition(reason: TrackedStopReason, condition: StopCondition<ToolSet>): StopCondition<ToolSet> {
  const state: TrackedStopState = { reason, step: undefined }
  const tracked: StopCondition<ToolSet> = async ({ steps }) => {
    const shouldStop = await condition({ steps })
    state.step = shouldStop ? steps.at(-1) : undefined
    return shouldStop
  }
  trackedStopConditions.set(tracked, state)
  return tracked
}

/** The cap is an outcome reported by this condition, not inferred later from the result shape. */
export function createToolCallLimitStopCondition(toolCallLimit: number): StopCondition<ToolSet> {
  return trackStopCondition('tool-call-limit', stepCountIs(toolCallLimit))
}

/** Record a clean steer yield so it can take precedence if the cap also fires on the same step. */
export function trackSteerYieldStopCondition(condition: StopCondition<ToolSet>): StopCondition<ToolSet> {
  return trackStopCondition('steer-yield', condition)
}

function wasStopReasonTriggered(
  stopWhen: ToolLoopStopWhen,
  reason: TrackedStopReason,
  steps: Array<StepResult<ToolSet>>
): boolean {
  const finalStep = steps.at(-1)
  if (!finalStep || !stopWhen) return false

  const conditions = Array.isArray(stopWhen) ? stopWhen : [stopWhen]
  return conditions.some((condition) => {
    const state = trackedStopConditions.get(condition)
    return state?.reason === reason && state.step === finalStep
  })
}

export function getLastTerminalToolFailure(steps: Array<StepResult<ToolSet>>): TerminalToolFailure | undefined {
  const lastStep = steps.at(-1)
  if (!lastStep) return undefined

  for (const result of lastStep.toolResults) {
    if (result.providerExecuted) continue
    const failure = getTrustedLocalToolTerminalFailure(result.output)
    if (failure) return failure
  }

  return undefined
}

/** Stop at the step boundary immediately after a trusted local tool reports a terminal failure. */
export const stopOnTerminalToolFailure: StopCondition<ToolSet> = ({ steps }) =>
  getLastTerminalToolFailure(steps) !== undefined

export class ToolLoopTerminalError extends Error {
  constructor(
    message: string,
    public readonly i18nKey?: string
  ) {
    super(message)
    this.name = 'ToolLoopTerminalError'
  }
}

/** Convert a trusted terminal tool stop or an actually-triggered cap into an application error. */
export function resolveToolLoopTerminalError({
  steps,
  stopWhen
}: ToolLoopTerminationInput): ToolLoopTerminalError | undefined {
  const terminalFailure = getLastTerminalToolFailure(steps)
  if (terminalFailure) {
    return new ToolLoopTerminalError(terminalFailure.userMessage ?? terminalFailure.error, terminalFailure.i18nKey)
  }

  // AI SDK evaluates all stop conditions with Promise.all. A queued steer is a deliberate clean
  // boundary and therefore wins when it becomes true on the same step as the hard cap.
  if (wasStopReasonTriggered(stopWhen, 'steer-yield', steps)) return undefined

  if (wasStopReasonTriggered(stopWhen, 'tool-call-limit', steps)) {
    return new ToolLoopTerminalError(TOOL_CALL_LIMIT_MESSAGE, 'tool_call_limit_reached')
  }

  return undefined
}
