import type { CherryUIMessageChunk } from '@shared/data/types/message'
import type { LanguageModelUsage } from 'ai'
import { describe, expect, it } from 'vitest'

import { attachUsageObserver } from '../usage'

// ──────────────────────────────────────────────────────────────────────────────
// Minimal fake Agent that records write() calls and lets tests fire registered
// on() callbacks.
// ──────────────────────────────────────────────────────────────────────────────

type HandlerMap = Record<string, ((...args: unknown[]) => void)[]>

function makeFakeAgent() {
  const handlers: HandlerMap = {}
  const written: CherryUIMessageChunk[] = []

  const agent = {
    on(key: string, fn: (...args: unknown[]) => void) {
      ;(handlers[key] ??= []).push(fn)
      return () => {
        const list = handlers[key]
        if (list) {
          const i = list.indexOf(fn)
          if (i >= 0) list.splice(i, 1)
        }
      }
    },
    write(chunk: CherryUIMessageChunk) {
      written.push(chunk)
    },
    fire(key: string, ...args: unknown[]) {
      for (const fn of handlers[key] ?? []) fn(...args)
    }
  }

  return { agent, written }
}

function makeStep(usage: LanguageModelUsage) {
  return { usage }
}

// ──────────────────────────────────────────────────────────────────────────────

describe('attachUsageObserver', () => {
  it('emits totalTokens as running sum and contextTokens as last-step value', () => {
    const { agent, written } = makeFakeAgent()

    attachUsageObserver(agent as any)

    agent.fire('onStart')

    // Step A
    agent.fire(
      'onStepFinish',
      makeStep({ inputTokens: 10, outputTokens: 5, totalTokens: 15, outputTokenDetails: {} } as LanguageModelUsage)
    )

    // Step B
    agent.fire(
      'onStepFinish',
      makeStep({ inputTokens: 20, outputTokens: 8, totalTokens: 28, outputTokenDetails: {} } as LanguageModelUsage)
    )

    expect(written).toHaveLength(2)

    const lastChunk = written[1]
    expect(lastChunk.type).toBe('message-metadata')
    const meta = (lastChunk as Extract<CherryUIMessageChunk, { type: 'message-metadata' }>).messageMetadata

    // totalTokens must be the running SUM (15 + 28 = 43)
    expect(meta?.totalTokens).toBe(43)

    // contextTokens must be the LAST step's totalTokens (28), not the sum
    expect(meta?.contextTokens).toBe(28)
  })

  it('resets contextTokens on onStart so a new turn does not carry forward the previous value', () => {
    const { agent, written } = makeFakeAgent()

    attachUsageObserver(agent as any)

    // First turn
    agent.fire('onStart')
    agent.fire(
      'onStepFinish',
      makeStep({ inputTokens: 10, outputTokens: 5, totalTokens: 15, outputTokenDetails: {} } as LanguageModelUsage)
    )
    agent.fire(
      'onStepFinish',
      makeStep({ inputTokens: 20, outputTokens: 8, totalTokens: 28, outputTokenDetails: {} } as LanguageModelUsage)
    )
    // After two steps, contextTokens should be 28.
    const afterSecondStep = written[1]
    expect(
      (afterSecondStep as Extract<CherryUIMessageChunk, { type: 'message-metadata' }>).messageMetadata?.contextTokens
    ).toBe(28)

    // Second turn — onStart resets everything
    agent.fire('onStart')
    agent.fire(
      'onStepFinish',
      makeStep({ inputTokens: 5, outputTokens: 4, totalTokens: 9, outputTokenDetails: {} } as LanguageModelUsage)
    )

    const lastChunk = written[written.length - 1]
    const meta = (lastChunk as Extract<CherryUIMessageChunk, { type: 'message-metadata' }>).messageMetadata

    // totalTokens resets: only step C = 9
    expect(meta?.totalTokens).toBe(9)
    // contextTokens resets: should be 9, not 28 + 9
    expect(meta?.contextTokens).toBe(9)
  })
})
