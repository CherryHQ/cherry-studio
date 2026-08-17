import type { LanguageModelV3, LanguageModelV3CallOptions, LanguageModelV3Prompt } from '@ai-sdk/provider'
import { describe, expect, it, vi } from 'vitest'

import { buildIdentitySection } from '../../params/assembleSystemPrompt'
import { rewriteSystemIdentity, withIdentityRewrite } from '../identityRewrite'

const primaryIdentity = buildIdentitySection(
  { id: 'openai::gpt-4', name: 'GPT-4' } as never,
  { id: 'openai', name: 'OpenAI' } as never
)
const fallbackIdentity = buildIdentitySection(
  { id: 'deepseek::deepseek-v4', name: 'DeepSeek-V4' } as never,
  { id: 'deepseek', name: 'DeepSeek' } as never
)

describe('rewriteSystemIdentity', () => {
  it('replaces the leading identity section and preserves the rest', () => {
    const system = `${primaryIdentity}\n\nassistant base prompt`
    const rewritten = rewriteSystemIdentity(system, fallbackIdentity)
    expect(rewritten).toBe(`${fallbackIdentity}\n\nassistant base prompt`)
    expect(rewritten).not.toContain('GPT-4')
    expect(rewritten).toContain('DeepSeek-V4')
  })

  it('replaces the identity section when it is the whole system prompt', () => {
    expect(rewriteSystemIdentity(primaryIdentity, fallbackIdentity)).toBe(fallbackIdentity)
  })

  it('prepends the identity when the system prompt has no identity section', () => {
    const system = 'plain prompt without identity'
    expect(rewriteSystemIdentity(system, fallbackIdentity)).toBe(`${fallbackIdentity}\n\nplain prompt without identity`)
  })

  it('returns only the identity section for an empty system prompt', () => {
    expect(rewriteSystemIdentity('', fallbackIdentity)).toBe(fallbackIdentity)
  })
})

describe('withIdentityRewrite', () => {
  const makePrompt = (systemContent?: string): LanguageModelV3Prompt => [
    ...(systemContent !== undefined ? [{ role: 'system' as const, content: systemContent }] : []),
    { role: 'user' as const, content: [{ type: 'text' as const, text: 'hi' }] }
  ]

  it('rewrites the system message content passed to the underlying model', async () => {
    const doGenerate = vi.fn<(input: LanguageModelV3CallOptions) => Promise<{ text: string }>>(async () => ({
      text: 'ok'
    }))
    const base = { doGenerate } as unknown as LanguageModelV3
    const wrapped = withIdentityRewrite(base, fallbackIdentity)

    await wrapped.doGenerate({ prompt: makePrompt(primaryIdentity) } as LanguageModelV3CallOptions)
    expect(doGenerate).toHaveBeenCalledTimes(1)
    const input = doGenerate.mock.calls[0][0]
    const systemMessage = input.prompt.find((m) => m.role === 'system')
    expect(systemMessage?.content).toBe(fallbackIdentity)
    expect(input.prompt).toHaveLength(2)
  })

  it('leaves non-system messages untouched', async () => {
    const doGenerate = vi.fn<(input: LanguageModelV3CallOptions) => Promise<{ text: string }>>(async () => ({
      text: 'ok'
    }))
    const base = { doGenerate } as unknown as LanguageModelV3
    const wrapped = withIdentityRewrite(base, fallbackIdentity)

    await wrapped.doGenerate({ prompt: makePrompt(primaryIdentity) } as LanguageModelV3CallOptions)
    const input = doGenerate.mock.calls[0][0]
    const userMessage = input.prompt.find((m) => m.role === 'user')
    expect(userMessage?.content).toEqual([{ type: 'text', text: 'hi' }])
  })

  it('passes the request through untouched when the prompt has no system message', async () => {
    const doGenerate = vi.fn<(input: LanguageModelV3CallOptions) => Promise<{ text: string }>>(async () => ({
      text: 'ok'
    }))
    const base = { doGenerate } as unknown as LanguageModelV3
    const wrapped = withIdentityRewrite(base, fallbackIdentity)

    const request = { prompt: makePrompt() } as LanguageModelV3CallOptions
    await wrapped.doGenerate(request)
    expect(doGenerate).toHaveBeenCalledWith(request)
  })
})
