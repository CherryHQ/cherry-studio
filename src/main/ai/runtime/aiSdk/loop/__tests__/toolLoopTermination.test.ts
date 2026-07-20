import type { StepResult, ToolSet } from 'ai'
import { describe, expect, it } from 'vitest'

import {
  getLastTerminalToolFailure,
  resolveToolLoopTerminalError,
  stopOnTerminalToolFailure
} from '../toolLoopTermination'

function makeSteps(outputs: unknown[], count = 1): Array<StepResult<ToolSet>> {
  return Array.from(
    { length: count },
    (_, index) =>
      ({
        toolResults:
          index === count - 1
            ? outputs.map((output) => ({ type: 'tool-result', toolCallId: 'tc-1', toolName: 'web_fetch', output }))
            : []
      }) as never
  )
}

describe('tool-loop termination', () => {
  it('stops on an explicitly terminal, non-retryable tool output', async () => {
    const steps = makeSteps([
      {
        error: 'raw failure',
        retryable: false,
        terminal: true,
        userMessage: 'Change the proxy setting.',
        i18nKey: 'web_search_proxy_fake_ip'
      }
    ])

    expect(getLastTerminalToolFailure(steps)).toEqual({
      error: 'raw failure',
      userMessage: 'Change the proxy setting.',
      i18nKey: 'web_search_proxy_fake_ip'
    })
    expect(await stopOnTerminalToolFailure({ steps })).toBe(true)
    expect(resolveToolLoopTerminalError({ steps, finishReason: 'tool-calls', toolCallLimit: 20 })).toMatchObject({
      message: 'Change the proxy setting.',
      i18nKey: 'web_search_proxy_fake_ip'
    })
  })

  it('does not stop on a transient tool error', async () => {
    const steps = makeSteps([{ error: 'upstream 503', retryable: true }])

    expect(getLastTerminalToolFailure(steps)).toBeUndefined()
    expect(await stopOnTerminalToolFailure({ steps })).toBe(false)
  })

  it('turns a tool-call finish at the configured cap into an explicit error', () => {
    const error = resolveToolLoopTerminalError({
      steps: makeSteps([{ ok: true }], 3),
      finishReason: 'tool-calls',
      toolCallLimit: 3
    })

    expect(error).toMatchObject({
      name: 'ToolLoopTerminalError',
      i18nKey: 'tool_call_limit_reached'
    })
  })

  it('keeps a normal model finish successful at the same step count', () => {
    expect(
      resolveToolLoopTerminalError({
        steps: makeSteps([], 3),
        finishReason: 'stop',
        toolCallLimit: 3
      })
    ).toBeUndefined()
  })
})
