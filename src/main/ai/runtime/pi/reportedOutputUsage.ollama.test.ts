import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { createOllama } from 'ollama-ai-provider-v2'
import { describe, expect, it } from 'vitest'

import { providerReportedOutputUsage } from '@shared/ai/reportedOutputUsage'

const prompt = [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'answer' }] }]

describe('pinned Ollama adapter output count presence', () => {
  it.each([undefined, 0, 25])(
    'preserves omitted versus explicit output count %s through stream normalization',
    async (evalCount) => {
      const payload = {
        model: 'fixture',
        created_at: '2026-11-28T00:00:00Z',
        message: { role: 'assistant', content: 'partial' },
        done: true,
        done_reason: 'length',
        prompt_eval_count: 3,
        ...(evalCount !== undefined ? { eval_count: evalCount } : {})
      }
      const provider = createOllama({
        baseURL: 'https://ollama.invalid/api',
        fetch: async () =>
          new Response(JSON.stringify(payload) + '\n', { headers: { 'content-type': 'application/x-ndjson' } })
      })
      const result = await provider('fixture').doStream({ prompt })
      const parts: LanguageModelV3StreamPart[] = []
      for await (const part of result.stream) parts.push(part)
      expect(parts.some((part) => part.type === 'error')).toBe(false)
      const terminal = parts.find((part) => part.type === 'finish')
      if (!terminal || terminal.type !== 'finish') throw new Error('Missing finish event')
      expect(terminal.finishReason.unified).toBe('length')
      expect(terminal.usage.outputTokens.total).toBe(evalCount ?? 0)
      expect(terminal.usage.raw).toEqual(evalCount === undefined ? {} : { eval_count: evalCount })
      expect(
        providerReportedOutputUsage({
          outputTokens: terminal.usage.outputTokens.total,
          raw: terminal.usage.raw
        })
      ).toEqual({ outputTokens: evalCount ?? null, reasoningTokens: null })
    }
  )

  it.each([undefined, 0, 25])('preserves output count presence during non-streaming chat %s', async (evalCount) => {
    const provider = createOllama({
      baseURL: 'https://ollama.invalid/api',
      fetch: async () =>
        Response.json({
          model: 'fixture',
          created_at: '2026-11-28T00:00:00Z',
          message: { role: 'assistant', content: 'partial' },
          done: true,
          done_reason: 'length',
          ...(evalCount !== undefined ? { eval_count: evalCount } : {})
        })
    })
    const result = await provider('fixture').doGenerate({ prompt })
    expect(
      providerReportedOutputUsage({ outputTokens: result.usage.outputTokens.total, raw: result.usage.raw }).outputTokens
    ).toBe(evalCount ?? null)
  })
})
