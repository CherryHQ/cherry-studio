import { createOllama } from 'ollama-ai-provider-v2'
import { describe, expect, it, vi } from 'vitest'

// Regression for the patched ollama-ai-provider-v2 options schema: discovery exposes exactly the
// thinking levels a model advertises through /api/show, so the transport must accept any level
// string — a closed literal list rejects an advertised level (e.g. xhigh) before the request is
// even sent.
describe('ollama native think levels', () => {
  const chatResponse = () =>
    new Response(
      JSON.stringify({
        model: 'qwen3:8b',
        created_at: new Date().toISOString(),
        message: { role: 'assistant', content: 'hi' },
        done: true,
        done_reason: 'stop',
        total_duration: 1,
        load_duration: 1,
        prompt_eval_count: 1,
        eval_count: 1
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )

  it.each(['low', 'high', 'xhigh'] as const)('sends an advertised think level %s to the API', async (think) => {
    const fetchMock = vi.fn().mockImplementation(async () => chatResponse())
    const ollama = createOllama({ baseURL: 'http://127.0.0.1:11434/api', fetch: fetchMock })
    const model = ollama.chat('qwen3:8b')

    await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      providerOptions: { ollama: { think } }
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body.think).toBe(think)
  })

  it.each([true, false])('keeps accepting the boolean think switch (%s)', async (think) => {
    const fetchMock = vi.fn().mockImplementation(async () => chatResponse())
    const ollama = createOllama({ baseURL: 'http://127.0.0.1:11434/api', fetch: fetchMock })
    const model = ollama.chat('qwen3:8b')

    await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      providerOptions: { ollama: { think } }
    })

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body.think).toBe(think)
  })
})
