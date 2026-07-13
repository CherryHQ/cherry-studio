import { describe, expect, it } from 'vitest'

import { stripBackgroundCss } from '../stripBackgroundCss'

describe('stripBackgroundCss', () => {
  it('removes a spaced background shorthand declaration', () => {
    expect(stripBackgroundCss('body { background: red; }')).toBe('body { }')
  })

  it('keeps non-background declarations intact', () => {
    expect(stripBackgroundCss('p { color: red; background: blue; }')).toBe('p { color: red; }')
  })

  it('passes through empty / undefined unchanged', () => {
    expect(stripBackgroundCss('')).toBe('')
    expect(stripBackgroundCss(undefined)).toBeUndefined()
  })

  // --- fragile cases the original (leading-space + trailing-semicolon) regex missed ---

  it('removes a minified declaration right after the opening brace (no space)', () => {
    expect(stripBackgroundCss('body{background:red}')).toBe('body{}')
  })

  it('removes a declaration with no trailing semicolon', () => {
    expect(stripBackgroundCss('body{color:white;background-color:black}')).toBe('body{color:white;}')
  })

  it('removes background-image in compressed CSS', () => {
    expect(stripBackgroundCss('a{background-image:url(x)}')).toBe('a{}')
  })

  it('keeps non-color/image background sub-properties (e.g. background-position)', () => {
    expect(stripBackgroundCss('a{background-position:center;background:red}')).toBe('a{background-position:center;}')
  })
})
