import type { LanguageModelV3Prompt } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

import { ENDPOINT_TYPE } from '@shared/data/types/model'

import type { RequestScope } from '../../scope'
import { createFlattenTextContentMiddleware, flattenTextContentFeature } from '../flattenTextContent'

const run = async (prompt: LanguageModelV3Prompt) => {
  const middleware = createFlattenTextContentMiddleware()
  const result = await middleware.transformParams!({ params: { prompt }, type: 'stream', model: {} as never })
  return result.prompt
}

describe('flattenTextContentFeature.applies', () => {
  it('applies to chat-completions endpoints only', () => {
    const scope = (endpointType: string) => ({ endpointType }) as unknown as RequestScope
    expect(flattenTextContentFeature.applies!(scope(ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS))).toBe(true)
    expect(flattenTextContentFeature.applies!(scope(ENDPOINT_TYPE.ANTHROPIC_MESSAGES))).toBe(false)
  })
})

describe('flatten middleware', () => {
  it('merges multiple text parts (dropping part-level cache markers) into one', async () => {
    const prompt = await run([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'a', providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } },
          { type: 'text', text: 'b' }
        ]
      }
    ])
    expect(prompt).toEqual([{ role: 'user', content: [{ type: 'text', text: 'a\n\nb' }] }])
  })

  it('leaves multimodal and single-part messages untouched', async () => {
    const input: LanguageModelV3Prompt = [
      { role: 'user', content: [{ type: 'text', text: 'a' }] },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'a' },
          { type: 'file', data: 'AAAA', mediaType: 'image/png' }
        ]
      }
    ]
    expect(await run(input)).toEqual(input)
  })
})
