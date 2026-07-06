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
          totalTokens: 14,
          promptTokens: 10,
          completionTokens: 4,
          thoughtsTokens: 1,
          noCacheTokens: 3,
          cacheReadTokens: 5,
          cacheWriteTokens: 2
        }
      }
    ])
  })
})
