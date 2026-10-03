import { createXai } from '@ai-sdk/xai'
import { generateText, streamText } from 'ai'
import { describe, expect, it } from 'vitest'

import { ExtensionRegistry } from '../core/ExtensionRegistry'
import { coreExtensions } from '../core/initialization'

const image = {
  type: 'image_generation_call',
  id: 'image-1',
  status: 'completed',
  result: 'iVBORw0KGgo=',
  prompt: 'A red square'
}
const response = (item = image) => ({
  object: 'response',
  id: 'response-1',
  status: 'completed',
  model: 'grok-4.7',
  output: [item],
  usage: { input_tokens: 10, output_tokens: 10 }
})
const nativeTools = (provider: ReturnType<typeof createXai>) => {
  const registry = new ExtensionRegistry()
  registry.registerAll(coreExtensions)
  return registry.getToolFactory('xai-responses', 'imageGeneration')!(provider)().tools!
}

// Contract: the official native image payload must survive the V3 backport without local execution.
describe('xAI native image generation', () => {
  it('serializes the native tool and preserves the returned image and prompt', async () => {
    let request: Record<string, unknown> | undefined
    const provider = createXai({
      apiKey: 'fixture-only',
      fetch: async (_url, init) => {
        request = JSON.parse(String(init?.body))
        return new Response(JSON.stringify(response()), { headers: { 'content-type': 'application/json' } })
      }
    })
    const tools = nativeTools(provider)
    expect(tools.imageGeneration.execute).toBeUndefined()
    const result = await generateText({ model: provider.responses('grok-4.7'), prompt: 'Draw a square', tools })
    expect(request?.tools).toEqual([{ type: 'image_generation' }])
    expect(result.toolCalls[0]).toMatchObject({ toolName: 'imageGeneration', providerExecuted: true, input: {} })
    expect(result.toolResults[0]).toMatchObject({ output: { result: image.result, prompt: image.prompt } })
    expect(JSON.stringify(result.response.messages)).not.toContain(image.result)
  })

  // Regression: a terminal call without an image must remain an error rather than a successful empty artifact.
  it('does not claim an image when the terminal response has no result', async () => {
    const provider = createXai({
      apiKey: 'fixture-only',
      fetch: async () =>
        new Response(JSON.stringify(response({ ...image, result: undefined } as unknown as typeof image)), {
          headers: { 'content-type': 'application/json' }
        })
    })
    const result = await generateText({
      model: provider.responses('grok-4.7'),
      prompt: 'Draw a square',
      tools: nativeTools(provider)
    })
    expect(result.toolResults).toHaveLength(0)
    expect(JSON.stringify(result.content)).toContain('Image generation failed')
  })

  it('emits one call and one final image after repeated native progress events', async () => {
    const events = [
      { type: 'response.created', response: response() },
      { type: 'response.image_generation_call.in_progress', item_id: image.id, output_index: 0 },
      { type: 'response.image_generation_call.generating', item_id: image.id, output_index: 0 },
      { type: 'response.image_generation_call.completed', item_id: image.id, output_index: 0 },
      { type: 'response.output_item.done', output_index: 0, item: image },
      { type: 'response.completed', response: response() }
    ]
    const provider = createXai({
      apiKey: 'fixture-only',
      fetch: async () =>
        new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
          headers: { 'content-type': 'text/event-stream' }
        })
    })
    const result = streamText({
      model: provider.responses('grok-4.7'),
      prompt: 'Draw a square',
      tools: nativeTools(provider)
    })
    await result.consumeStream()
    expect(await result.toolCalls).toHaveLength(1)
    expect(await result.toolResults).toHaveLength(1)
    expect((await result.toolResults)[0]).toMatchObject({ output: { result: image.result, prompt: image.prompt } })
  })
})
