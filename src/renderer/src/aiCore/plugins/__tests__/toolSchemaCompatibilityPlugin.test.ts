import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

import { createToolSchemaCompatibilityPlugin } from '../toolSchemaCompatibilityPlugin'

async function runMiddleware(params: LanguageModelV3CallOptions, dropUntypedArrays = false) {
  const plugin = createToolSchemaCompatibilityPlugin({ dropUntypedArrays })
  const context: {
    middlewares: Array<{ transformParams: (options: Record<string, unknown>) => Promise<LanguageModelV3CallOptions> }>
  } = { middlewares: [] }
  void plugin.configureContext?.(context as never)
  return context.middlewares[0].transformParams({ params, type: 'generate', model: {} })
}

function makeParams(inputSchema: Record<string, unknown>, strict = false): LanguageModelV3CallOptions {
  return {
    prompt: [],
    tools: [
      {
        type: 'function',
        name: 'inspect',
        description: 'Inspect input',
        inputSchema,
        strict
      }
    ]
  }
}

describe('toolSchemaCompatibilityPlugin', () => {
  it('removes provider-rejected schema keywords without removing same-named properties', async () => {
    const result = await runMiddleware(
      makeParams(
        {
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          type: 'object',
          properties: {
            count: { type: 'integer', minimum: 0, maximum: 10 },
            minimum: { type: 'number' }
          }
        },
        true
      )
    )

    expect(result.tools?.[0]).toMatchObject({
      inputSchema: {
        type: 'object',
        properties: {
          count: { type: 'integer' },
          minimum: { type: 'number' }
        }
      }
    })
  })

  it('drops only tools with untyped arrays on native Gemini routes', async () => {
    for (const values of [{ type: 'array' }, { type: 'array', items: { type: [] } }]) {
      const params = makeParams({ type: 'object', properties: { values } })

      const geminiResult = await runMiddleware(params, true)
      const otherResult = await runMiddleware(params, false)

      expect(geminiResult.tools).toEqual([])
      expect(otherResult.tools).toHaveLength(1)
    }
  })
})
