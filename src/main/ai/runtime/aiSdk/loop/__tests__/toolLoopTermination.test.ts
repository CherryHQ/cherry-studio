import type { StepResult, ToolSet } from 'ai'
import { describe, expect, it } from 'vitest'

import { markTrustedLocalToolTerminalFailure } from '../localToolTerminalOutcome'
import {
  createToolCallLimitStopCondition,
  getLastTerminalToolFailure,
  resolveToolLoopTerminalError,
  stopOnTerminalToolFailure,
  trackSteerYieldStopCondition
} from '../toolLoopTermination'

type ToolResultOverrides = {
  toolName?: string
  input?: unknown
  providerExecuted?: boolean
}

function makeSteps(
  outputs: unknown[],
  count = 1,
  { toolName = 'local_lookup', input = {}, providerExecuted }: ToolResultOverrides = {}
): Array<StepResult<ToolSet>> {
  return Array.from(
    { length: count },
    (_, index) =>
      ({
        toolResults:
          index === count - 1
            ? outputs.map((output) => ({
                type: 'tool-result',
                toolCallId: 'tc-1',
                toolName,
                input,
                output,
                providerExecuted
              }))
            : []
      }) as never
  )
}

function terminalFailure() {
  return {
    error: 'raw failure',
    retryable: false,
    terminal: true,
    userMessage: 'Check the network connection.',
    i18nKey: 'web_lookup_network_error'
  }
}

describe('tool-loop termination', () => {
  it('stops on a terminal failure carrying trusted local-tool provenance', async () => {
    const output = markTrustedLocalToolTerminalFailure(terminalFailure())
    const steps = makeSteps([output])

    expect(getLastTerminalToolFailure(steps)).toEqual({
      error: 'raw failure',
      userMessage: 'Check the network connection.',
      i18nKey: 'web_lookup_network_error'
    })
    expect(await stopOnTerminalToolFailure({ steps })).toBe(true)
    expect(resolveToolLoopTerminalError({ steps, stopWhen: undefined })).toMatchObject({
      message: 'Check the network connection.',
      i18nKey: 'web_lookup_network_error'
    })
  })

  it('does not trust a matching JSON shape returned by an external tool', async () => {
    const steps = makeSteps([terminalFailure()], 1, { toolName: 'mcp__server__lookup', input: {} })

    expect(getLastTerminalToolFailure(steps)).toBeUndefined()
    expect(await stopOnTerminalToolFailure({ steps })).toBe(false)
  })

  it('rejects a provider-executed result even when the object is locally marked', () => {
    const output = markTrustedLocalToolTerminalFailure(terminalFailure())

    expect(getLastTerminalToolFailure(makeSteps([output], 1, { providerExecuted: true }))).toBeUndefined()
  })

  it('accepts a trusted result returned unchanged by a local wrapper without parsing its private input', () => {
    const output = markTrustedLocalToolTerminalFailure(terminalFailure())
    const wrapped = makeSteps([output], 1, {
      toolName: 'tool_invoke',
      input: { opaque: 'wrapper-owned-payload' }
    })

    expect(getLastTerminalToolFailure(wrapped)).toMatchObject({ error: 'raw failure' })
  })

  it('does not mark or stop on a transient local-tool error', async () => {
    const output = markTrustedLocalToolTerminalFailure({ error: 'upstream 503', retryable: true })
    const steps = makeSteps([output])

    expect(getLastTerminalToolFailure(steps)).toBeUndefined()
    expect(await stopOnTerminalToolFailure({ steps })).toBe(false)
  })

  it('turns an actually-triggered cap into an explicit error', async () => {
    const steps = makeSteps([{ ok: true }], 3)
    const stopWhen = createToolCallLimitStopCondition(3)
    expect(await stopWhen({ steps })).toBe(true)

    expect(resolveToolLoopTerminalError({ steps, stopWhen })).toMatchObject({
      name: 'ToolLoopTerminalError',
      i18nKey: 'tool_call_limit_reached'
    })
  })

  it('does not infer a cap hit when maxToolCalls=1 pauses for approval before evaluating stopWhen', () => {
    const steps = makeSteps([], 1)
    const stopWhen = createToolCallLimitStopCondition(1)

    // AI SDK does not evaluate stopWhen while a tool approval is pending.
    expect(resolveToolLoopTerminalError({ steps, stopWhen })).toBeUndefined()
  })

  it('lets a queued steer win when steer and cap both trigger on the same step', async () => {
    const steps = makeSteps([{ ok: true }], 3)
    const cap = createToolCallLimitStopCondition(3)
    const steer = trackSteerYieldStopCondition(() => true)
    const stopWhen = [cap, steer]
    await Promise.all(stopWhen.map((condition) => condition({ steps })))

    expect(resolveToolLoopTerminalError({ steps, stopWhen })).toBeUndefined()
  })
})
