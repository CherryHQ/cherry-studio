import { describe, expect, it } from 'vitest'

import { routeToEndpoint } from '../provider'

describe('routeToEndpoint', () => {
  it('returns plain host with empty endpoint when no endpoint suffix is present', () => {
    expect(routeToEndpoint('https://ark.cn-beijing.volces.com/api/v3')).toEqual({
      baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
      endpoint: ''
    })
  })

  it('trims trailing slashes from the base URL when no endpoint matches', () => {
    expect(routeToEndpoint('https://api.example.com/v1/')).toEqual({
      baseURL: 'https://api.example.com/v1',
      endpoint: ''
    })
  })

  it('splits chat/completions suffix from the base URL', () => {
    expect(routeToEndpoint('https://ark.cn-beijing.volces.com/api/v3/chat/completions')).toEqual({
      baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
      endpoint: 'chat/completions'
    })
  })

  it('splits responses suffix from the base URL', () => {
    expect(routeToEndpoint('https://api.example.com/v1/responses')).toEqual({
      baseURL: 'https://api.example.com/v1',
      endpoint: 'responses'
    })
  })

  it('splits messages suffix from the base URL', () => {
    expect(routeToEndpoint('https://api.anthropic.com/v1/messages')).toEqual({
      baseURL: 'https://api.anthropic.com/v1',
      endpoint: 'messages'
    })
  })

  it('strips a trailing # marker and returns empty endpoint when no matching endpoint exists', () => {
    expect(routeToEndpoint('https://ark.cn-beijing.volces.com/api/v3#')).toEqual({
      baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
      endpoint: ''
    })
  })

  it('strips a trailing # marker and splits chat/completions suffix', () => {
    expect(routeToEndpoint('https://ark.cn-beijing.volces.com/api/v3/chat/completions#')).toEqual({
      baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
      endpoint: 'chat/completions'
    })
  })

  it('handles empty input gracefully', () => {
    expect(routeToEndpoint('')).toEqual({ baseURL: '', endpoint: '' })
  })
})
