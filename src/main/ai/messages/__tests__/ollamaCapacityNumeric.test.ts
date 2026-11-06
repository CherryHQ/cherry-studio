import { estimateTokenCount } from 'tokenx'
import { describe, expect, it, vi } from 'vitest'

import { makeModel, makeProvider } from '../../__tests__/fixtures'
import { assertPrimaryOllamaCallWithinWindow, OllamaPromptExceedsContextError } from '../attachmentBudget'
vi.mock('@main/data/services/ProviderService', () => ({ providerService: { getByProviderId: vi.fn() } }))
vi.mock('@main/data/services/ModelService', () => ({ modelService: { getByKey: vi.fn() } }))
describe('capped Ollama with the production tokenizer', () => {
  const provider = makeProvider({
    id: 'ollama',
    defaultChatEndpoint: 'ollama-chat',
    endpointConfigs: { 'ollama-chat': { baseUrl: 'http://localhost:11434', adapterFamily: 'ollama' } }
  })
  const model = makeModel({ id: 'ollama::qwen', providerId: 'ollama', contextWindow: 32768 })
  const snapshot = { uniqueModelId: 'ollama::qwen', trainedContextWindow: 32768, numCtx: 4096 }
  const check = (text: string, numCtx = 4096, maxOutputTokens?: number) =>
    assertPrimaryOllamaCallWithinWindow({
      call: { prompt: [{ role: 'user', content: [{ type: 'text', text }] }], maxOutputTokens },
      provider,
      model,
      ollamaNumCtx: { ...snapshot, numCtx }
    })
  it('rejects a long numeric run that tokenx estimates as one token', async () => {
    const text = '1234567890'.repeat(1200)
    expect(estimateTokenCount(text)).toBe(1)
    await expect(check(text)).rejects.toBeInstanceOf(OllamaPromptExceedsContextError)
  })
  it('accepts short text and leaves the uncapped window unchanged', async () => {
    await expect(check('1234567890'.repeat(10))).resolves.toBeUndefined()
    await expect(check('1234567890'.repeat(1200), 32768)).resolves.toBeUndefined()
  })
  it('counts UTF-8 text bytes and output reservation conservatively', async () => {
    await expect(check('中'.repeat(1300))).rejects.toBeInstanceOf(OllamaPromptExceedsContextError)
    await expect(check('1234567890'.repeat(100), 4096, 3800)).rejects.toBeInstanceOf(OllamaPromptExceedsContextError)
  })
})
