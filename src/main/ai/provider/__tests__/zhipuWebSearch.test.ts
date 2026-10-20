import { describe, expect, it } from 'vitest'

import { transformZhipuRequestBody } from '../zhipuWebSearch'

describe('transformZhipuRequestBody', () => {
  it('moves the web_search marker into the tools array', () => {
    const body = transformZhipuRequestBody({
      model: 'glm-5',
      web_search: { enable: true, search_engine: 'search_pro', search_result: true }
    })
    expect(body.web_search).toBeUndefined()
    expect(body.tools).toEqual([
      { type: 'web_search', web_search: { enable: true, search_engine: 'search_pro', search_result: true } }
    ])
  })

  it('preserves existing function tools', () => {
    const fn = { type: 'function', function: { name: 'lookup', parameters: {} } }
    const body = transformZhipuRequestBody({ tools: [fn], web_search: { enable: true } })
    expect(body.tools).toEqual([fn, { type: 'web_search', web_search: { enable: true } }])
  })

  it('is a no-op without the marker', () => {
    const args = { model: 'glm-5', messages: [] }
    expect(transformZhipuRequestBody(args)).toBe(args)
  })
})
