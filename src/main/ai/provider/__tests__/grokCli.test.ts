import { describe, expect, it } from 'vitest'

import { buildGrokCliRequestHeaders, normalizeGrokModelId, rewriteGrokCliResponsesBody } from '../grokCli'

describe('rewriteGrokCliResponsesBody', () => {
  it('hoists system/developer turns into instructions and drops them from input', () => {
    const out = rewriteGrokCliResponsesBody({
      model: 'grok-build',
      instructions: 'base',
      input: [
        { role: 'system', content: 'you are helpful' },
        { role: 'developer', content: [{ type: 'input_text', text: 'be terse' }] },
        { role: 'user', content: [{ type: 'input_text', text: 'hi' }] }
      ]
    })
    expect(out.instructions).toBe('base\n\nyou are helpful\n\nbe terse')
    expect(out.input).toEqual([{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }])
  })

  it('drops replayed reasoning items and empty-content turns', () => {
    const out = rewriteGrokCliResponsesBody({
      input: [
        { type: 'reasoning', summary: [] },
        { role: 'assistant', content: '' },
        { role: 'user', content: 'keep me' }
      ]
    })
    expect(out.input).toEqual([{ role: 'user', content: 'keep me' }])
  })

  it('strips reasoning/cache knobs and the encrypted-reasoning include', () => {
    const out = rewriteGrokCliResponsesBody({
      reasoning: { effort: 'high' },
      prompt_cache_retention: '24h',
      include: ['reasoning.encrypted_content', 'file_search_call.results'],
      response_format: { type: 'json_object' }
    })
    expect(out.reasoning).toBeUndefined()
    expect(out.prompt_cache_retention).toBeUndefined()
    expect(out.include).toEqual(['file_search_call.results'])
    expect(out.text).toEqual({ format: { type: 'json_object' } })
    expect(out.response_format).toBeUndefined()
  })

  it('drops the include array entirely when only encrypted reasoning was requested', () => {
    const out = rewriteGrokCliResponsesBody({ include: ['reasoning.encrypted_content'] })
    expect(out.include).toBeUndefined()
  })
})

describe('normalizeGrokModelId', () => {
  it('lower-cases and strips any provider prefix', () => {
    expect(normalizeGrokModelId('grok-cli/Grok-Build')).toBe('grok-build')
    expect(normalizeGrokModelId('grok-composer-2.5-fast')).toBe('grok-composer-2.5-fast')
  })
})

describe('buildGrokCliRequestHeaders', () => {
  it('sets the bearer token plus the Grok CLI proxy markers', () => {
    const headers = buildGrokCliRequestHeaders(
      { 'content-type': 'application/json' },
      { accessToken: 'tok', modelId: 'grok-cli/grok-build' }
    )
    expect(headers.get('Authorization')).toBe('Bearer tok')
    expect(headers.get('x-grok-client-identifier')).toBe('cherry-studio')
    expect(headers.get('x-xai-token-auth')).toBe('xai-grok-cli')
    expect(headers.get('x-grok-model-override')).toBe('grok-build')
    expect(headers.get('content-type')).toBe('application/json')
  })

  it('omits the model-override header when no model id is known', () => {
    const headers = buildGrokCliRequestHeaders(undefined, { accessToken: 'tok', modelId: '' })
    expect(headers.has('x-grok-model-override')).toBe(false)
  })
})
