import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { generateText, tool } from 'ai'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

async function captureToolConfig(name?: string) {
  let requestBody: Record<string, unknown> = {}
  const provider = createGoogleGenerativeAI({
    apiKey: 'test',
    name,
    fetch: async (_input, init) => {
      requestBody = JSON.parse(init?.body as string)
      return new Response(
        JSON.stringify({
          candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 }
        }),
        { headers: { 'content-type': 'application/json' } }
      )
    }
  })

  await generateText({
    model: provider('gemini-3.1-pro-preview'),
    prompt: 'Inspect this',
    tools: {
      search: provider.tools.googleSearch({}),
      inspect: tool({
        description: 'Inspect input',
        inputSchema: z.object({ value: z.string() })
      })
    }
  })

  return requestBody.toolConfig as Record<string, unknown>
}

describe('patched @ai-sdk/google combined tool config', () => {
  it('keeps server-side tool invocations for the official Gemini API', async () => {
    await expect(captureToolConfig()).resolves.toMatchObject({ includeServerSideToolInvocations: true })
  })

  it('omits server-side tool invocations for Vertex', async () => {
    await expect(captureToolConfig('google.vertex.test')).resolves.not.toHaveProperty(
      'includeServerSideToolInvocations'
    )
  })
})
