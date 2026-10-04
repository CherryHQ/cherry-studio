import type { UIMessageChunk } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Agent } from '../../Agent'

const mockCreateAgent = vi.fn()
vi.mock('@cherrystudio/ai-core', () => ({
  createAgent: (...args: unknown[]) => mockCreateAgent(...args)
}))

// #21315: billed, text-less assistant replies must not publish a success finish.
describe('empty assistant response', () => {
  beforeEach(() => vi.clearAllMocks())

  function setup(chunks: UIMessageChunk[]) {
    mockCreateAgent.mockResolvedValue({
      stream: vi.fn().mockResolvedValue({
        toUIMessageStream: () =>
          new ReadableStream<UIMessageChunk>({
            start(controller) {
              for (const chunk of chunks) controller.enqueue(chunk)
              controller.close()
            }
          }),
        steps: Promise.resolve([
          {
            toolResults: [],
            usage: { outputTokens: 8192, outputTokenDetails: { textTokens: 8192, reasoningTokens: 0 } }
          }
        ])
      })
    })
    const onFinish = vi.fn()
    const onError = vi.fn()
    const agent = new Agent({
      providerId: 'openai',
      providerSettings: {},
      modelId: 'test-model',
      hookParts: [{ onFinish, onError }]
    })
    const received: UIMessageChunk[] = []
    const completion = agent.stream([], new AbortController().signal).pipeTo(
      new WritableStream({
        write(chunk) {
          received.push(chunk)
        }
      })
    )
    return { received, completion, onFinish, onError }
  }

  it.each(['stop', 'length'] as const)('rejects a billed empty %s response before success', async (finishReason) => {
    const { received, completion, onFinish, onError } = setup([
      { type: 'start-step' },
      { type: 'finish', finishReason }
    ])
    await expect(completion).rejects.toMatchObject({ name: 'EmptyResponseError', i18nKey: 'no_response' })
    expect(received).not.toContainEqual(expect.objectContaining({ type: 'finish' }))
    expect(onFinish).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith({ error: expect.objectContaining({ name: 'EmptyResponseError' }) })
  })

  it('preserves text already delivered when the provider reaches its length limit', async () => {
    const { received, completion } = setup([
      { type: 'text-start', id: 'text' },
      { type: 'text-delta', id: 'text', delta: 'Partial answer' },
      { type: 'text-end', id: 'text' },
      { type: 'finish', finishReason: 'length' }
    ])
    await completion
    expect(received).toContainEqual({ type: 'text-delta', id: 'text', delta: 'Partial answer' })
    expect(received.at(-1)).toEqual({ type: 'finish', finishReason: 'length' })
  })

  it('allows a tool approval pause without assistant text', async () => {
    const { received, completion } = setup([
      { type: 'tool-input-available', toolCallId: 'tool', toolName: 'read', input: {} },
      { type: 'finish', finishReason: 'tool-calls' }
    ])
    await completion
    expect(received.at(-1)).toEqual({ type: 'finish', finishReason: 'tool-calls' })
  })

  it('allows a generated file without assistant text', async () => {
    const { received, completion } = setup([
      { type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,aGVsbG8=' },
      { type: 'finish', finishReason: 'stop' }
    ])
    await completion
    expect(received.at(-1)).toEqual({ type: 'finish', finishReason: 'stop' })
  })
})
