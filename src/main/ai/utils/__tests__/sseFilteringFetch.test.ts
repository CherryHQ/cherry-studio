import { describe, expect, it } from 'vitest'

import { createSSEFilteringFetch } from '../sseFilteringFetch'

/**
 * Helper: create a mock Response with an SSE body from an array of SSE frame strings.
 */
function mockSSEResponse(frames: string[]): Response {
  const body = frames.join('')
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' }
  })
}

/**
 * Helper: collect all text from a Response body.
 */
async function collectBody(response: Response): Promise<string> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let result = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    result += decoder.decode(value, { stream: true })
  }
  return result
}

describe('createSSEFilteringFetch', () => {
  it('passes through standard OpenAI chat completion chunks unchanged', async () => {
    const standardFrames = [
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":123,"model":"gpt-4","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n',
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":123,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":123,"model":"gpt-4","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n'
    ]

    const innerFetch = async () => mockSSEResponse(standardFrames)
    const filteredFetch = createSSEFilteringFetch(innerFetch)

    const response = await filteredFetch('http://localhost:8642/v1/chat/completions', {
      method: 'POST',
      body: '{}'
    })

    const body = await collectBody(response)
    expect(body).toContain('"role":"assistant"')
    expect(body).toContain('"content":"Hello"')
    expect(body).toContain('[DONE]')
  })

  it('drops hermes.tool.progress events with status:running', async () => {
    const frames = [
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":123,"model":"hermes-agent","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n',
      'event: hermes.tool.progress\ndata: {"tool":"web_search","emoji":"⚽","label":"searching...","toolCallId":"call_02b","status":"running"}\n\n',
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":123,"model":"hermes-agent","choices":[{"index":0,"delta":{"content":"Here are the results"},"finish_reason":null}]}\n\n',
      'event: hermes.tool.progress\ndata: {"tool":"web_search","toolCallId":"call_02b","status":"completed"}\n\n',
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":123,"model":"hermes-agent","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n'
    ]

    const innerFetch = async () => mockSSEResponse(frames)
    const filteredFetch = createSSEFilteringFetch(innerFetch)

    const response = await filteredFetch('http://localhost:8642/v1/chat/completions', {
      method: 'POST',
      body: '{}'
    })

    const body = await collectBody(response)

    // Standard chunks should pass through
    expect(body).toContain('"role":"assistant"')
    expect(body).toContain('"content":"Here are the results"')
    expect(body).toContain('[DONE]')

    // Custom events should be filtered out
    expect(body).not.toContain('hermes.tool.progress')
    expect(body).not.toContain('"status":"running"')
    expect(body).not.toContain('"status":"completed"')
  })

  it('does not filter non-chat-completions requests', async () => {
    const frames = [
      'event: response.created\ndata: {"id":"resp-1","type":"response.created"}\n\n',
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Hello"}\n\n',
      'event: response.completed\ndata: {"id":"resp-1","type":"response.completed"}\n\n'
    ]

    const innerFetch = async () => mockSSEResponse(frames)
    const filteredFetch = createSSEFilteringFetch(innerFetch)

    const response = await filteredFetch('http://localhost:8642/v1/responses', {
      method: 'POST',
      body: '{}'
    })

    const body = await collectBody(response)

    // All events should pass through for non-chat-completions requests
    expect(body).toContain('response.created')
    expect(body).toContain('response.output_text.delta')
    expect(body).toContain('response.completed')
  })

  it('passes through non-SSE responses unchanged', async () => {
    const jsonResponse = new Response(JSON.stringify({ id: 'chatcmpl-1' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })

    const innerFetch = async () => jsonResponse
    const filteredFetch = createSSEFilteringFetch(innerFetch)

    const response = await filteredFetch('http://localhost:8642/v1/chat/completions', {
      method: 'POST',
      body: '{}'
    })

    // Should be the exact same response object (not wrapped)
    expect(response).toBe(jsonResponse)
  })

  it('handles \\r\\n\\r\\n line endings', async () => {
    const frames = [
      'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"content":"Hi"}}]}\r\n\r\n',
      'event: custom.event\r\ndata: {"custom":true}\r\n\r\n',
      'data: [DONE]\r\n\r\n'
    ]

    const innerFetch = async () => mockSSEResponse(frames)
    const filteredFetch = createSSEFilteringFetch(innerFetch)

    const response = await filteredFetch('http://localhost:8642/v1/chat/completions', {
      method: 'POST',
      body: '{}'
    })

    const body = await collectBody(response)

    expect(body).toContain('"content":"Hi"')
    expect(body).toContain('[DONE]')
    expect(body).not.toContain('custom.event')
  })

  it('handles chunked delivery (frame split across multiple chunks)', async () => {
    // Simulate a frame arriving in two chunks
    const chunk1 = 'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"content":"Hel'
    const chunk2 = 'lo"}}]}\n\nevent: tool.progress\ndata: {"status":"running"}\n\n'
    const chunk3 = 'data: [DONE]\n\n'

    const innerFetch = async () => {
      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(chunk1))
          controller.enqueue(encoder.encode(chunk2))
          controller.enqueue(encoder.encode(chunk3))
          controller.close()
        }
      })
      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' }
      })
    }

    const filteredFetch = createSSEFilteringFetch(innerFetch)

    const response = await filteredFetch('http://localhost:8642/v1/chat/completions', {
      method: 'POST',
      body: '{}'
    })

    const body = await collectBody(response)

    expect(body).toContain('"content":"Hello"')
    expect(body).toContain('[DONE]')
    expect(body).not.toContain('tool.progress')
    expect(body).not.toContain('"status":"running"')
  })
})
