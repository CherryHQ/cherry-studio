import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

// Guards the Ark dialect hunks in patches/@ai-sdk__openai@3.0.109.patch.
// Ark's built-in web search sends url_citation without start_index/end_index (#20940).
const arkCitation = { type: 'url_citation', title: 'Example', url: 'https://example.com/article' }

const prompt = [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'hi' }] }]

function arkModel(body: string, contentType: string) {
  return createOpenAI({
    apiKey: 'test',
    fetch: async () => new Response(body, { headers: { 'content-type': contentType } })
  }).responses('doubao-seed-2-1-turbo-260628')
}

describe('patched @ai-sdk/openai accepts Ark url_citation without start_index/end_index', () => {
  it('streams the citation without an error part', async () => {
    const event = {
      type: 'response.output_text.annotation.added',
      item_id: 'msg_1',
      output_index: 0,
      content_index: 0,
      annotation_index: 0,
      annotation: arkCitation
    }
    const { stream } = await arkModel(`data: ${JSON.stringify(event)}\n\n`, 'text/event-stream').doStream({ prompt })

    const types: LanguageModelV3StreamPart['type'][] = []
    for await (const chunk of stream) types.push(chunk.type)

    expect(types).not.toContain('error')
  })

  it('parses the citation in a non-streaming response', async () => {
    const body = {
      id: 'resp_1',
      created_at: 1792320364,
      model: 'doubao-seed-2-1-turbo-260628',
      output: [
        {
          type: 'message',
          role: 'assistant',
          id: 'msg_1',
          status: 'completed',
          content: [{ type: 'output_text', text: 'cited', annotations: [arkCitation] }]
        }
      ]
    }

    await expect(arkModel(JSON.stringify(body), 'application/json').doGenerate({ prompt })).resolves.toBeDefined()
  })
})
