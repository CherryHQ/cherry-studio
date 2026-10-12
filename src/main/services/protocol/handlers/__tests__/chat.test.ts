import { describe, expect, it } from 'vitest'

import { parseChatProtocolUrl } from '../chat'

describe('launcher chat protocol', () => {
  it('leaves mode to the user preference and requires explicit submission', () => {
    expect(parseChatProtocolUrl(new URL('cherrystudio://chat/new?prompt=where+is+paris'))).toEqual({
      prompt: 'where is paris',
      temporary: undefined,
      submit: false
    })
  })

  it('keeps an explicit saved mode distinct from the default', () => {
    expect(parseChatProtocolUrl(new URL('cherrystudio://chat/new?temporary=false'))).toEqual({
      prompt: '',
      temporary: false,
      submit: false
    })
  })

  it('preserves an encoded multilingual prompt in a temporary immediate chat', () => {
    const url = new URL('cherrystudio://chat/new')
    const prompt = 'איפה פריז? مرحبا\n& ? # + % $(echo hello)'
    url.searchParams.set('prompt', prompt)
    url.searchParams.set('temporary', 'true')
    url.searchParams.set('submit', 'true')
    expect(parseChatProtocolUrl(url)).toEqual({ prompt, temporary: true, submit: true })
  })

  it.each([
    'https://chat/new?prompt=test',
    'cherrystudio://other/new?prompt=test',
    'cherrystudio://chat/delete?prompt=test',
    'cherrystudio://user:password@chat/new',
    'cherrystudio://chat/new#ignored',
    'cherrystudio://chat/new?submit=yes',
    'cherrystudio://chat/new?temporary=1',
    'cherrystudio://chat/new?prompt=a&prompt=b',
    'cherrystudio://chat/new?model=untrusted'
  ])('rejects unsupported launcher input: %s', (url) => {
    expect(parseChatProtocolUrl(new URL(url))).toBeNull()
  })

  it('rejects oversized prompts before window creation or model execution', () => {
    const url = new URL('cherrystudio://chat/new')
    url.searchParams.set('prompt', 'a'.repeat(16_001))
    expect(parseChatProtocolUrl(url)).toBeNull()
  })
})
