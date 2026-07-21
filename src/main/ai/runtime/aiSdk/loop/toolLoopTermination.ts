import { WEB_FETCH_TOOL_NAME, WEB_SEARCH_TOOL_NAME } from '@shared/ai/builtinTools'
import { stepCountIs, type StepResult, type StopCondition, type ToolSet } from 'ai'

import { isTrustedWebLookupTerminalFailure } from '../../../tools/adapters/aiSdk/builtin/webLookupTerminalFailure'
import { TOOL_INVOKE_TOOL_NAME } from '../../../tools/adapters/aiSdk/meta/toolInvoke'

export interface TerminalToolFailure {
  error: string
  userMessage?: string
  i18nKey?: string
}

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

const WEB_TOOL_NAMES = new Set<string>([WEB_SEARCH_TOOL_NAME, WEB_FETCH_TOOL_NAME])

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

function terminalToolFailureFromOutput(output: unknown): TerminalToolFailure | undefined {
  if (typeof output !== 'object' || output === null || Array.isArray(output)) return undefined

  const candidate = output as Record<string, unknown>
  if (candidate.terminal !== true || candidate.retryable !== false || typeof candidate.error !== 'string') {
    return undefined
  }

  return {
    error: candidate.error,
    ...(typeof candidate.userMessage === 'string' && { userMessage: candidate.userMessage }),
    ...(typeof candidate.i18nKey === 'string' && { i18nKey: candidate.i18nKey })
  }
}

function isTrustedWebToolResult(result: StepResult<ToolSet>['toolResults'][number]): boolean {
  if (result.providerExecuted || !isTrustedWebLookupTerminalFailure(result.output)) return false
  if (WEB_TOOL_NAMES.has(result.toolName)) return true
  if (result.toolName !== TOOL_INVOKE_TOOL_NAME) return false

  const input = result.input
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false

  const innerToolName = (input as Record<string, unknown>).name
  return typeof innerToolName === 'string' && WEB_TOOL_NAMES.has(innerToolName)
}

export function getLastTerminalToolFailure(steps: Array<StepResult<ToolSet>>): TerminalToolFailure | undefined {
  const lastStep = steps.at(-1)
  if (!lastStep) return undefined

  for (const result of lastStep.toolResults) {
    if (!isTrustedWebToolResult(result)) continue
    const failure = terminalToolFailureFromOutput(result.output)
    if (failure) return failure
  }

  return undefined
}

/** Stop at the step boundary immediately after a trusted builtin web tool reports a terminal failure. */
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
