import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

import { createAihubmix } from '../../aihubmix/aihubmixProvider'
import { captureWithFetch } from './captureRequest'

/**
 * AiHubMix → Anthropic tool-schema boundary.
 *
 * Guards `patches/@ai-sdk__anthropic.patch`, which wires the backported
 * `sanitizeJsonSchema` into `prepareTools` so tool `input_schema` is reduced to
 * the JSON Schema subset Anthropic strict tool use / structured outputs accept
 * (shared limits — see the patch). Without it, a tool whose schema carries
 * `maxItems` makes AiHubMix's Claude backend reject the request with a 400
 * ("For 'array' type, property 'maxItems' is not supported"). If a future
 * `@ai-sdk/anthropic` bump drops the patch wiring, this test fails loudly.
 *
 * The backported sanitizer strips every unsupported validation keyword
 * (`minItems`/`maxItems`/`minLength`/`maxLength`/...) and folds the dropped
 * constraints into the node `description`, keeping `type`/`items`/`required`.
 */
function callOptionsWithToolSchema(inputSchema: unknown): LanguageModelV3CallOptions {
  return {
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    tools: [
      {
        type: 'function',
        name: 'web_fetch',
        description: 'Fetch URLs',
        inputSchema
      }
    ]
  } as unknown as LanguageModelV3CallOptions
}

function urlsSchemaFrom(body: unknown): Record<string, unknown> {
  const tool = (body as { tools?: Array<{ input_schema?: { properties?: Record<string, unknown> } }> }).tools?.[0]
  return (tool?.input_schema?.properties?.urls ?? {}) as Record<string, unknown>
}

describe('AiHubMix → Anthropic tool-schema boundary (patched @ai-sdk/anthropic)', () => {
  it('strips array maxItems/minItems from tool input_schema and folds them into description', async () => {
    const req = await captureWithFetch((fetch) =>
      createAihubmix({ apiKey: 'sk', fetch })
        .languageModel('claude-sonnet-4-6')
        .doStream(
          callOptionsWithToolSchema({
            type: 'object',
            properties: {
              urls: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 20 }
            },
            required: ['urls'],
            additionalProperties: false
          })
        )
    )

    expect(req.url).toBe('https://aihubmix.com/v1/messages')
    const urls = urlsSchemaFrom(req.body)
    expect(urls.maxItems).toBeUndefined() // unsupported keyword → stripped (the reported 400)
    expect(urls.minItems).toBeUndefined() // folded into description, not sent as a keyword
    expect(urls.type).toBe('array') // structure preserved
    expect(urls.items).toEqual({ type: 'string' })
    expect(String(urls.description)).toContain('max items: 20') // constraint preserved as advisory text
  })

  it('strips string min/maxLength too', async () => {
    const req = await captureWithFetch((fetch) =>
      createAihubmix({ apiKey: 'sk', fetch })
        .languageModel('claude-sonnet-4-6')
        .doStream(
          callOptionsWithToolSchema({
            type: 'object',
            properties: {
              urls: { type: 'string', minLength: 2, maxLength: 200 }
            },
            required: ['urls'],
            additionalProperties: false
          })
        )
    )

    const urls = urlsSchemaFrom(req.body)
    expect(urls.minLength).toBeUndefined()
    expect(urls.maxLength).toBeUndefined()
  })
})
