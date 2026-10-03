import { gte } from 'semver'
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

  it('drops empty reasoning and empty-content turns', () => {
    const out = rewriteGrokCliResponsesBody({
      input: [
        { type: 'reasoning', summary: [] },
        { role: 'assistant', content: '' },
        { role: 'user', content: 'keep me' }
      ]
    })
    expect(out.input).toEqual([{ role: 'user', content: 'keep me' }])
  })

  it('strips unsupported legacy effort and cache retention without losing encrypted reasoning', () => {
    const out = rewriteGrokCliResponsesBody({
      model: 'grok-build',
      reasoning: { effort: 'high' },
      prompt_cache_retention: '24h',
      include: ['reasoning.encrypted_content', 'file_search_call.results'],
      response_format: { type: 'json_object' }
    })
    expect(out.reasoning).toBeUndefined()
    expect(out.prompt_cache_retention).toBeUndefined()
    expect(out.include).toEqual(['reasoning.encrypted_content', 'file_search_call.results'])
    expect(out.text).toEqual({ format: { type: 'json_object' } })
    expect(out.response_format).toBeUndefined()
  })

  it.each(['grok-build', 'grok-composer-2.5-fast'])('omits effort for legacy model %s', (model) => {
    expect(rewriteGrokCliResponsesBody({ model, reasoning: { effort: 'high' } }).reasoning).toBeUndefined()
  })

  it.each(['low', 'medium', 'high', 'xhigh'])('keeps Grok 4.7 effort %s without OpenAI summary options', (effort) => {
    const out = rewriteGrokCliResponsesBody({ model: 'grok-4.7', reasoning: { effort, summary: 'auto' } })
    expect(out.reasoning).toEqual({ effort })
  })

  it('preserves opaque reasoning between tool calls and their results', () => {
    const reasoning = { type: 'reasoning', id: 'rs_1', encrypted_content: 'opaque', summary: [] }
    const call = { type: 'function_call', call_id: 'call_1', name: 'read', arguments: '{}' }
    const result = { type: 'function_call_output', call_id: 'call_1', output: 'file content' }
    const out = rewriteGrokCliResponsesBody({
      model: 'grok-4.7',
      input: [reasoning, call, result],
      include: ['reasoning.encrypted_content', 'reasoning.encrypted_content']
    })
    expect(out.input).toEqual([reasoning, call, result])
    expect(out.include).toEqual(['reasoning.encrypted_content'])
    expect(out.store).toBe(false)
  })

  it('requests encrypted reasoning even when the SDK supplied no include', () => {
    expect(rewriteGrokCliResponsesBody({ model: 'grok-4.7' }).include).toEqual(['reasoning.encrypted_content'])
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
    expect(gte(headers.get('x-grok-client-version')!, '1.0.13')).toBe(true)
    expect(headers.get('x-authenticateresponse')).toBe('authenticate-response')
    expect(headers.get('x-grok-client-mode')).toBe('interactive')
    expect(headers.get('x-grok-model-override')).toBe('grok-build')
    expect(headers.get('content-type')).toBe('application/json')
  })

  it('omits the model-override header when no model id is known', () => {
    const headers = buildGrokCliRequestHeaders(undefined, { accessToken: 'tok', modelId: '' })
    expect(headers.has('x-grok-model-override')).toBe(false)
  })
})
