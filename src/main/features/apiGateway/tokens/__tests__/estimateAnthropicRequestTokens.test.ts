import type { MessageCreateParams } from '@anthropic-ai/sdk/resources'
import { makeModel } from '@main/ai/__tests__/fixtures/model'
import { makeProvider } from '@main/ai/__tests__/fixtures/provider'
import { ENDPOINT_TYPE, MODEL_CAPABILITY } from '@shared/data/types/model'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ resolveGatewayModelAddress: vi.fn() }))

vi.mock('../../utils/models', () => ({ resolveGatewayModelAddress: mocks.resolveGatewayModelAddress }))
vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }
}))

import { estimateAnthropicRequestTokens } from '../estimateAnthropicRequestTokens'

/** Provider whose endpoint resolves to a given dialect. */
const anthropicProvider = () =>
  makeProvider({
    defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
    endpointConfigs: { [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { adapterFamily: 'anthropic' } }
  })

const openaiProvider = () =>
  makeProvider({
    defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
    endpointConfigs: { [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { adapterFamily: 'openai-compatible' } }
  })

const resolveTo = (model: ReturnType<typeof makeModel>, provider = anthropicProvider()) =>
  mocks.resolveGatewayModelAddress.mockReturnValue({
    providerId: 'p',
    apiModelId: 'm',
    uniqueModelId: 'p::m',
    provider,
    model
  })

const bigImage = 'A'.repeat(100_000)
const imageBlock = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: bigImage } } as const

const body = (messages: unknown, tools?: unknown) =>
  ({ model: 'p:m', messages, tools }) as unknown as MessageCreateParams

const visionModel = makeModel({ capabilities: [MODEL_CAPABILITY.IMAGE_RECOGNITION] })
const textModel = makeModel({ capabilities: [] })

beforeEach(() => vi.clearAllMocks())

describe('estimateAnthropicRequestTokens', () => {
  it('#17079: a base64 image nested in tool_result is counted as text (~100K), not ~0', async () => {
    resolveTo(textModel) // even a non-vision model: nested tool_result images ride as text, never stripped
    const messages = [
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'shot', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: [imageBlock] }] }
    ]
    // ~16.7K (tokenx over the base64 text) vs the old heuristic's 100000*0.75/100 = 750.
    expect(await estimateAnthropicRequestTokens(body(messages))).toBeGreaterThan(10_000)
  })

  it('counts a surviving top-level vision image with the per-dialect constant, not its base64 length', async () => {
    resolveTo(visionModel)
    const count = await estimateAnthropicRequestTokens(body([{ role: 'user', content: [imageBlock] }]))
    // anthropic image constant (~1590) + framing — far below the ~100K base64 length.
    expect(count).toBeGreaterThan(1000)
    expect(count).toBeLessThan(3000)
  })

  it('drops a top-level image to a short note for a non-vision model', async () => {
    resolveTo(textModel)
    const count = await estimateAnthropicRequestTokens(body([{ role: 'user', content: [imageBlock] }]))
    expect(count).toBeGreaterThan(0)
    expect(count).toBeLessThan(200)
  })

  it('adds tool-definition tokens from body.tools', async () => {
    resolveTo(textModel)
    const messages = [{ role: 'user', content: 'hi' }]
    const tools = [
      {
        name: 'search',
        description: 'search the web',
        input_schema: { type: 'object', properties: { q: { type: 'string', description: 'x'.repeat(500) } } }
      }
    ]
    const withTools = await estimateAnthropicRequestTokens(body(messages, tools))
    const without = await estimateAnthropicRequestTokens(body(messages))
    expect(withTools).toBeGreaterThan(without + 50)
  })

  it('degrades to a finite count (no throw) when the model cannot be resolved', async () => {
    mocks.resolveGatewayModelAddress.mockImplementation(() => {
      throw new Error('unknown model')
    })
    const count = await estimateAnthropicRequestTokens(body([{ role: 'user', content: 'hello world' }]))
    expect(Number.isFinite(count)).toBe(true)
    expect(count).toBeGreaterThan(0)
  })

  it('openai wire: a tool_result image is gated to a note even for a VISION model (no media slot)', async () => {
    resolveTo(visionModel, openaiProvider())
    const messages = [
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'shot', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: [imageBlock] }] }
    ]
    const tools = [{ name: 'shot', description: 'd', input_schema: { type: 'object' } }]
    const count = await estimateAnthropicRequestTokens(body(messages, tools))
    // Note text + framing + tool def — nowhere near the ~100K base64 or the 765 pixel constant.
    expect(count).toBeLessThan(500)
  })

  it('degrades to a raw-size heuristic (no 500) when blocks are malformed', async () => {
    resolveTo(textModel)
    // `content: z.unknown()` lets null blocks through — conversion throws, the wrapper catches.
    const count = await estimateAnthropicRequestTokens(body([{ role: 'user', content: [null] }], [null]))
    expect(Number.isFinite(count)).toBe(true)
    expect(count).toBeGreaterThan(0)
  })
})
