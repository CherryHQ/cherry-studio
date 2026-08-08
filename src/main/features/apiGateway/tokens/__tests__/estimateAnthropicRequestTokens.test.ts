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
  it('#17079: a base64 image nested in tool_result costs its image constant, not its base64 length', async () => {
    resolveTo(textModel)
    const messages = [
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'shot', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: [imageBlock] }] }
    ]
    // The converter relocates the nested image into the carrying user message as a real
    // `file` part, so it is counted with the anthropic image constant (~1590) — neither the
    // ~16.7K tokenx-over-base64 of the old flattening nor the old heuristic's 750.
    const count = await estimateAnthropicRequestTokens(body(messages))
    expect(count).toBeGreaterThan(1000)
    expect(count).toBeLessThan(3000)
  })

  it('counts a surviving top-level vision image with the per-dialect constant, not its base64 length', async () => {
    resolveTo(visionModel)
    const count = await estimateAnthropicRequestTokens(body([{ role: 'user', content: [imageBlock] }]))
    // anthropic image constant (~1590) + framing — far below the ~100K base64 length.
    expect(count).toBeGreaterThan(1000)
    expect(count).toBeLessThan(3000)
  })

  // Image policy belongs to attachment routing (OCR text / a deliberate native fallback that
  // must reach the provider), so `stripUnsupportedMedia` gates only audio+video. A top-level
  // image therefore still rides the wire for a non-vision model — and the estimate follows the
  // wire rather than second-guessing it.
  it('counts a top-level image for a non-vision model too (image policy is not gated here)', async () => {
    resolveTo(textModel)
    const count = await estimateAnthropicRequestTokens(body([{ role: 'user', content: [imageBlock] }]))
    expect(count).toBeGreaterThan(1000)
    expect(count).toBeLessThan(3000)
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

  // Relocation works on every wire (that is why it replaced in-tool-result media): the image
  // leaves the tool output and rides the user message, so even an openai wire counts a real
  // image with its own constant (~765) rather than a note — and never the ~100K base64.
  it('openai wire: a relocated tool_result image costs the openai image constant, not its base64', async () => {
    resolveTo(visionModel, openaiProvider())
    const messages = [
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'shot', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: [imageBlock] }] }
    ]
    const tools = [{ name: 'shot', description: 'd', input_schema: { type: 'object' } }]
    const count = await estimateAnthropicRequestTokens(body(messages, tools))
    expect(count).toBeGreaterThan(500)
    expect(count).toBeLessThan(2000)
  })

  it('degrades to a raw-size heuristic (no 500) when blocks are malformed', async () => {
    resolveTo(textModel)
    // `content: z.unknown()` lets null blocks through — conversion throws, the wrapper catches.
    const count = await estimateAnthropicRequestTokens(body([{ role: 'user', content: [null] }], [null]))
    expect(Number.isFinite(count)).toBe(true)
    expect(count).toBeGreaterThan(0)
  })
})
