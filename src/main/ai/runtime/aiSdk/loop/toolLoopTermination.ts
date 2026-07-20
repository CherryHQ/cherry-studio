import type { FinishReason, StepResult, StopCondition, ToolSet } from 'ai'

export interface TerminalToolFailure {
  error: string
  userMessage?: string
  i18nKey?: string
}

type ToolLoopTerminationInput = {
  steps: Array<StepResult<ToolSet>>
  finishReason: FinishReason | undefined
  toolCallLimit: number | undefined
}

const TOOL_CALL_LIMIT_MESSAGE =
  'The assistant reached the tool-call limit before producing a final answer. Try again or reduce the task scope.'

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

export function getLastTerminalToolFailure(steps: Array<StepResult<ToolSet>>): TerminalToolFailure | undefined {
  const lastStep = steps.at(-1)
  if (!lastStep) return undefined

  for (const result of lastStep.toolResults) {
    const failure = terminalToolFailureFromOutput(result.output)
    if (failure) return failure
  }

  return undefined
}

/** Stop at the step boundary immediately after a tool reports a failure that cannot be retried. */
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

/**
 * Convert clean-looking AI SDK loop termination into an explicit application error when no final
 * model response can follow: either a tool marked its output terminal, or the final step exhausted
 * the configured cap while still requesting tools.
 */
export function resolveToolLoopTerminalError({
  steps,
  finishReason,
  toolCallLimit
}: ToolLoopTerminationInput): ToolLoopTerminalError | undefined {
  const terminalFailure = getLastTerminalToolFailure(steps)
  if (terminalFailure) {
    return new ToolLoopTerminalError(terminalFailure.userMessage ?? terminalFailure.error, terminalFailure.i18nKey)
  }

  if (
    finishReason === 'tool-calls' &&
    toolCallLimit !== undefined &&
    Number.isInteger(toolCallLimit) &&
    toolCallLimit > 0 &&
    steps.length >= toolCallLimit
  ) {
    return new ToolLoopTerminalError(TOOL_CALL_LIMIT_MESSAGE, 'tool_call_limit_reached')
  }

  return undefined
}
