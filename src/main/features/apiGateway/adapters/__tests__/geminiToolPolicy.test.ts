import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { generateText, streamText } from 'ai'
import { describe, expect, it } from 'vitest'

import { GeminiMessageConverter } from '../converters/GeminiMessageConverter'

const converter = new GeminiMessageConverter()

const cases = [
  { config: undefined, mode: undefined, names: ['read', 'write', 'remove'] },
  { config: { mode: 'MODE_UNSPECIFIED' }, mode: undefined, names: ['read', 'write', 'remove'] },
  { config: { mode: 'AUTO' }, mode: 'AUTO', names: ['read', 'write', 'remove'] },
  { config: { mode: 'NONE' }, mode: 'NONE', names: ['read', 'write', 'remove'] },
  { config: { mode: 'ANY' }, mode: 'ANY', names: ['read', 'write', 'remove'] },
  { config: { mode: 'VALIDATED' }, mode: 'VALIDATED', names: ['read', 'write', 'remove'] },
  { config: { mode: 'ANY', allowedFunctionNames: ['read'] }, mode: 'ANY', names: ['read'] },
  { config: { mode: 'ANY', allowedFunctionNames: ['read', 'write'] }, mode: 'ANY', names: ['read', 'write'] },
  {
    config: { mode: 'VALIDATED', allowedFunctionNames: ['read', 'write'] },
    mode: 'VALIDATED',
    names: ['read', 'write']
  },
  { config: { mode: 'ANY', allowedFunctionNames: [] }, mode: 'ANY', names: ['read', 'write', 'remove'] }
] as const

describe('Gemini gateway tool policy on the provider wire', () => {
  for (const streaming of [false, true]) {
    it.each(cases)('preserves $config (streaming=' + streaming + ')', async ({ config, mode, names }) => {
      let body: {
        toolConfig?: { functionCallingConfig: { mode: string } }
        tools?: { functionDeclarations: { name: string }[] }[]
      } = {}
      const params = {
        contents: [{ role: 'user', parts: [{ text: 'Read a file.' }] }],
        tools: [
          {
            functionDeclarations: ['read', 'write', 'remove'].map((name) => ({
              name,
              parametersJsonSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
            }))
          }
        ],
        ...(config
          ? {
              toolConfig: {
                functionCallingConfig: {
                  mode: config.mode,
                  ...('allowedFunctionNames' in config
                    ? { allowedFunctionNames: [...config.allowedFunctionNames] }
                    : {})
                }
              }
            }
          : {})
      }
      const google = createGoogleGenerativeAI({
        apiKey: 'test-key',
        fetch: async (_input, init) => {
          body = JSON.parse(String(init?.body))
          const response = {
            candidates: [{ content: { role: 'model', parts: [{ text: 'OK' }] }, finishReason: 'STOP' }]
          }
          return new Response(streaming ? `data: ${JSON.stringify(response)}\n\n` : JSON.stringify(response), {
            headers: { 'content-type': streaming ? 'text/event-stream' : 'application/json' }
          })
        }
      })
      const tools = converter.toAiSdkTools(params)
      const options = {
        model: google('gemini-2.5-flash'),
        prompt: 'Read a file.',
        tools,
        ...converter.extractStreamOptions(params),
        maxRetries: 0
      }
      const result = streaming ? streamText(options) : await generateText(options)
      expect(await result.text).toBe('OK')
      if (mode === undefined) expect(body).not.toHaveProperty('toolConfig')
      else expect(body.toolConfig?.functionCallingConfig.mode).toBe(mode)
      expect(body.tools?.[0].functionDeclarations.map((tool) => tool.name)).toEqual(names)
      expect(Object.keys(tools!)).toEqual(['read', 'write', 'remove'])
    })
  }
})
