import type { LanguageModelUsage, UIMessageChunk } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import type { Agent } from '../../Agent'
import { attachUsageObserver } from '../usage'

type ObserverCallback = (payload?: unknown) => void

describe('attachUsageObserver', () => {
  it('emits accumulated cache token details in message metadata', () => {
    const callbacks: Record<string, ObserverCallback> = {}
    const chunks: UIMessageChunk[] = []
    const agent = {
      on: vi.fn((name: string, cb: ObserverCallback) => {
        callbacks[name] = cb
      }),
      write: vi.fn((chunk: UIMessageChunk) => chunks.push(chunk))
    } as unknown as Agent

    attachUsageObserver(agent)
    callbacks.onStart()
    callbacks.onStepFinish({
      usage: {
        inputTokens: 10,
        outputTokens: 4,
        totalTokens: 14,
        inputTokenDetails: { noCacheTokens: 3, cacheReadTokens: 5, cacheWriteTokens: 2 },
        outputTokenDetails: { textTokens: undefined, reasoningTokens: 1 }
      } satisfies LanguageModelUsage
    })

    expect(chunks).toEqual([
      {
        type: 'message-metadata',
        messageMetadata: {
          stats: {
            inputTokens: 10,
            outputTokens: 4,
            totalTokens: 14,
            inputTokenDetails: { noCacheTokens: 3, cacheReadTokens: 5, cacheWriteTokens: 2 },
            outputTokenDetails: { reasoningTokens: 1 }
          }
        }
      }
    ])
  })

  // Each tool-loop step is one upstream generation, so an OpenRouter-style
  // `usage.cost` describes that step alone — the earlier steps' cost must not
  // be dropped when the merged `raw` is overwritten by the last one.
  it('sums the provider-reported cost of every step', () => {
    const callbacks: Record<string, ObserverCallback> = {}
    const chunks: UIMessageChunk[] = []
    const agent = {
      on: vi.fn((name: string, cb: ObserverCallback) => {
        callbacks[name] = cb
      }),
      write: vi.fn((chunk: UIMessageChunk) => chunks.push(chunk))
    } as unknown as Agent

    attachUsageObserver(agent)
    callbacks.onStart()
    callbacks.onStepFinish({ usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14, raw: { cost: 0.25 } } })
    callbacks.onStepFinish({ usage: { inputTokens: 6, outputTokens: 2, totalTokens: 8, raw: { cost: 0.5 } } })

    expect(chunks).toEqual([
      expect.objectContaining({ messageMetadata: expect.objectContaining({ providerCostUsd: 0.25 }) }),
      expect.objectContaining({ messageMetadata: expect.objectContaining({ providerCostUsd: 0.75 }) })
    ])
  })
})
