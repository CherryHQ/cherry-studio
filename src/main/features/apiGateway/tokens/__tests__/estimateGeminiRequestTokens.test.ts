import { makeModel } from '@main/ai/__tests__/fixtures/model'
import { makeProvider } from '@main/ai/__tests__/fixtures/provider'
import { ENDPOINT_TYPE, MODEL_CAPABILITY } from '@shared/data/types/model'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { InputParamsMap } from '../../adapters'

type GeminiGenerateContentRequest = InputParamsMap['gemini']

const mocks = vi.hoisted(() => ({ resolveGatewayModelAddress: vi.fn() }))

vi.mock('../../utils/models', () => ({ resolveGatewayModelAddress: mocks.resolveGatewayModelAddress }))
vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }
}))

import { estimateGeminiRequestTokens } from '../estimateGeminiRequestTokens'

// openai-dialect provider → skips the google remote path, exercising the local walker.
const openaiProvider = () =>
  makeProvider({
    defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
    endpointConfigs: { [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { adapterFamily: 'openai-compatible' } }
  })

const resolveTo = (model: ReturnType<typeof makeModel>) =>
  mocks.resolveGatewayModelAddress.mockReturnValue({
    providerId: 'p',
    apiModelId: 'm',
    uniqueModelId: 'p::m',
    provider: openaiProvider(),
    model
  })

const body = (contents: unknown, tools?: unknown) => ({ contents, tools }) as unknown as GeminiGenerateContentRequest

beforeEach(() => vi.clearAllMocks())

describe('estimateGeminiRequestTokens', () => {
  it('counts a text request', async () => {
    resolveTo(makeModel({ capabilities: [] }))
    expect(
      await estimateGeminiRequestTokens(body([{ role: 'user', parts: [{ text: 'hello world' }] }]), 'p:m')
    ).toBeGreaterThan(0)
  })

  it('counts inlineData media (no longer rejected)', async () => {
    resolveTo(makeModel({ capabilities: [MODEL_CAPABILITY.IMAGE_RECOGNITION] }))
    const n = await estimateGeminiRequestTokens(
      body([{ role: 'user', parts: [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }] }]),
      'p:m'
    )
    expect(n).toBeGreaterThan(0)
  })

  it('adds function-declaration tool tokens', async () => {
    resolveTo(makeModel({ capabilities: [] }))
    const contents = [{ role: 'user', parts: [{ text: 'hi' }] }]
    const tools = [
      {
        functionDeclarations: [
          {
            name: 'search',
            description: 'd',
            parameters: { type: 'object', properties: { q: { type: 'string', description: 'x'.repeat(400) } } }
          }
        ]
      }
    ]
    const withTools = await estimateGeminiRequestTokens(body(contents, tools), 'p:m')
    const without = await estimateGeminiRequestTokens(body(contents), 'p:m')
    expect(withTools).toBeGreaterThan(without + 50)
  })

  it('degrades to a finite count on resolve failure', async () => {
    mocks.resolveGatewayModelAddress.mockImplementation(() => {
      throw new Error('unknown model')
    })
    const n = await estimateGeminiRequestTokens(body([{ role: 'user', parts: [{ text: 'hello' }] }]), 'p:m')
    expect(Number.isFinite(n)).toBe(true)
    expect(n).toBeGreaterThan(0)
  })

  it('degrades to a raw-size heuristic (no 500) on malformed parts', async () => {
    resolveTo(makeModel({ capabilities: [] }))
    // contents entries are loose objects — a null part throws in the converter, the wrapper catches.
    const n = await estimateGeminiRequestTokens(body([{ role: 'user', parts: [null] }]), 'p:m')
    expect(Number.isFinite(n)).toBe(true)
    expect(n).toBeGreaterThan(0)
  })
})
