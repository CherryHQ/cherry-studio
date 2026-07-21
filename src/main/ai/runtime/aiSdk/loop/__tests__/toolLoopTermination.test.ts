import type { StepResult, ToolSet } from 'ai'
import { describe, expect, it } from 'vitest'

import { markTrustedWebLookupTerminalFailure } from '../../../../tools/adapters/aiSdk/builtin/webLookupTerminalFailure'
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
  { toolName = 'web_fetch', input = { urls: ['https://example.com'] }, providerExecuted }: ToolResultOverrides = {}
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
    userMessage: 'Change the proxy setting.',
    i18nKey: 'web_search_proxy_fake_ip'
  }
}

describe('tool-loop termination', () => {
  it('stops on a terminal failure carrying builtin web-tool provenance', async () => {
    const output = markTrustedWebLookupTerminalFailure(terminalFailure())
    const steps = makeSteps([output])

    expect(getLastTerminalToolFailure(steps)).toEqual({
      error: 'raw failure',
      userMessage: 'Change the proxy setting.',
      i18nKey: 'web_search_proxy_fake_ip'
    })
    expect(await stopOnTerminalToolFailure({ steps })).toBe(true)
    expect(resolveToolLoopTerminalError({ steps, stopWhen: undefined })).toMatchObject({
      message: 'Change the proxy setting.',
      i18nKey: 'web_search_proxy_fake_ip'
    })
  })

  it('does not trust a matching JSON shape returned by an external tool', async () => {
    const steps = makeSteps([terminalFailure()], 1, { toolName: 'mcp__server__lookup', input: {} })

    expect(getLastTerminalToolFailure(steps)).toBeUndefined()
    expect(await stopOnTerminalToolFailure({ steps })).toBe(false)
  })

  it('requires local execution and the builtin web tool name even for a marked object', () => {
    const output = markTrustedWebLookupTerminalFailure(terminalFailure())

    expect(getLastTerminalToolFailure(makeSteps([output], 1, { providerExecuted: true }))).toBeUndefined()
    expect(
      getLastTerminalToolFailure(makeSteps([output], 1, { toolName: 'mcp__server__lookup', input: {} }))
    ).toBeUndefined()
  })

  it('accepts a deferred builtin web failure only when tool_invoke names that web tool', () => {
    const output = markTrustedWebLookupTerminalFailure(terminalFailure())
    const webInvoke = makeSteps([output], 1, {
      toolName: 'tool_invoke',
      input: { name: 'web_fetch', params: { urls: ['https://example.com'] } }
    })
    const mcpInvoke = makeSteps([output], 1, {
      toolName: 'tool_invoke',
      input: { name: 'mcp__server__lookup', params: {} }
    })

    expect(getLastTerminalToolFailure(webInvoke)).toMatchObject({ error: 'raw failure' })
    expect(getLastTerminalToolFailure(mcpInvoke)).toBeUndefined()
  })

  it('does not stop on a transient builtin web error', async () => {
    const steps = makeSteps([{ error: 'upstream 503', retryable: true }])

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
