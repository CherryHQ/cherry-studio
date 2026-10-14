import { describe, expect, it } from 'vitest'

import { appendDashScopeWebExtractor } from '../dashscopeWebExtractor'

describe('appendDashScopeWebExtractor', () => {
  it('appends web_extractor alongside web_search when thinking is enabled', () => {
    const body = JSON.stringify({ model: 'qwen3.7-max', tools: [{ type: 'web_search' }] })
    const out = JSON.parse(appendDashScopeWebExtractor(body) as string)
    expect(out.tools).toEqual([{ type: 'web_search' }, { type: 'web_extractor' }])
  })

  it('leaves the body untouched when web_search is absent (extractor requires search)', () => {
    const body = JSON.stringify({ model: 'x', tools: [{ type: 'function', function: {} }] })
    expect(appendDashScopeWebExtractor(body)).toBe(body)
  })

  it('keeps web_search only when the Responses wire disabled thinking (reasoning.effort=none)', () => {
    const body = JSON.stringify({ tools: [{ type: 'web_search' }], reasoning: { effort: 'none' } })
    expect(appendDashScopeWebExtractor(body)).toBe(body)
  })

  it('keeps web_search only when enable_thinking is false', () => {
    const body = JSON.stringify({ tools: [{ type: 'web_search' }], enable_thinking: false })
    expect(appendDashScopeWebExtractor(body)).toBe(body)
  })

  it('still appends web_extractor when thinking is enabled', () => {
    const body = JSON.stringify({ tools: [{ type: 'web_search' }], reasoning: { effort: 'high' } })
    const out = JSON.parse(appendDashScopeWebExtractor(body) as string)
    expect(out.tools).toEqual([{ type: 'web_search' }, { type: 'web_extractor' }])
  })

  it('is idempotent — does not double-append web_extractor', () => {
    const body = JSON.stringify({ tools: [{ type: 'web_search' }, { type: 'web_extractor' }] })
    expect(appendDashScopeWebExtractor(body)).toBe(body)
  })

  it('passes through non-string / non-JSON / tool-less bodies unchanged', () => {
    expect(appendDashScopeWebExtractor(undefined)).toBeUndefined()
    expect(appendDashScopeWebExtractor('not json')).toBe('not json')
    const noTools = JSON.stringify({ input: 'x' })
    expect(appendDashScopeWebExtractor(noTools)).toBe(noTools)
  })
})
