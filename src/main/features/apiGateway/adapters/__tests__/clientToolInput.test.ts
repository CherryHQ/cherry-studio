import { describe, expect, it } from 'vitest'

import { AiSdkToAnthropicSse } from '../stream/AiSdkToAnthropicSse'
import { AiSdkToGeminiSse } from '../stream/AiSdkToGeminiSse'
import { AiSdkToOpenAiResponsesSse } from '../stream/AiSdkToOpenAiResponsesSse'
import { AiSdkToOpenAiSse } from '../stream/AiSdkToOpenAiSse'

describe.each([
  {
    Adapter: AiSdkToAnthropicSse,
    response: { content: [{ type: 'tool_use', id: 'call', name: 'read_file', input: { path: { nested: true } } }] }
  },
  {
    Adapter: AiSdkToOpenAiSse,
    response: {
      choices: [
        {
          message: {
            tool_calls: [{ id: 'call', function: { name: 'read_file', arguments: '{"path":{"nested":true}}' } }]
          }
        }
      ]
    }
  },
  {
    Adapter: AiSdkToOpenAiResponsesSse,
    response: {
      output: [{ type: 'function_call', call_id: 'call', name: 'read_file', arguments: '{"path":{"nested":true}}' }]
    }
  },
  {
    Adapter: AiSdkToGeminiSse,
    response: {
      candidates: [{ content: { parts: [{ functionCall: { name: 'read_file', args: { path: { nested: true } } } }] } }]
    }
  }
])('$Adapter.name client tool input', ({ Adapter, response }) => {
  it('preserves schema-invalid object arguments for the client runtime', () => {
    const adapter = new Adapter({ model: 'fixture' })
    adapter.transformChunk({
      type: 'tool-input-error',
      toolCallId: 'call',
      toolName: 'read_file',
      input: { path: { nested: true } },
      errorText: 'path must be a string'
    })
    adapter.transformChunk({ type: 'finish', finishReason: 'tool-calls' })
    expect(adapter.buildNonStreamingResponse()).toMatchObject(response)
  })
})
