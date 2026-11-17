import { asSchema } from 'ai'
import { describe, expect, it } from 'vitest'

import { AnthropicMessageConverter } from '../converters/AnthropicMessageConverter'
import { GeminiMessageConverter } from '../converters/GeminiMessageConverter'
import { OpenAiMessageConverter } from '../converters/OpenAiMessageConverter'
import { OpenAiResponsesMessageConverter } from '../converters/OpenAiResponsesMessageConverter'

const schema = {
  type: 'object' as const,
  properties: { value: { $ref: '#/$defs/value' } },
  $defs: { value: { oneOf: [{ type: 'string' as const }, { type: 'integer' as const }] } },
  anyOf: [{ required: ['value'] }, { additionalProperties: false }],
  additionalProperties: false
}

// A Zod reconstruction used to erase references and composition before provider compatibility ran.
describe('gateway function schema contract', () => {
  it.each([
    [
      'Anthropic',
      () =>
        new AnthropicMessageConverter().toAiSdkTools({
          model: 'm',
          max_tokens: 10,
          messages: [],
          tools: [{ name: 'lookup', input_schema: schema, strict: true }]
        })
    ],
    [
      'OpenAI',
      () =>
        new OpenAiMessageConverter().toAiSdkTools({
          model: 'm',
          messages: [],
          tools: [{ type: 'function', function: { name: 'lookup', parameters: schema, strict: true } }]
        })
    ],
    [
      'Responses',
      () =>
        new OpenAiResponsesMessageConverter().toAiSdkTools({
          model: 'm',
          input: [],
          tools: [{ type: 'function', name: 'lookup', description: null, parameters: schema, strict: true }]
        })
    ],
    [
      'Gemini',
      () =>
        new GeminiMessageConverter().toAiSdkTools({
          tools: [{ functionDeclarations: [{ name: 'lookup', parametersJsonSchema: schema }] }]
        })
    ]
  ] as const)('preserves %s references and composition', (protocol, convert) => {
    const tools = convert()!
    expect(asSchema(tools.lookup.inputSchema).jsonSchema).toEqual(schema)
    if (protocol !== 'Gemini') expect(tools.lookup.strict).toBe(true)
  })
})
