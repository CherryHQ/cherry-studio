import { readFileSync } from 'node:fs'

import postcss, { type Rule } from 'postcss'
import { describe, expect, it } from 'vitest'

const markdownStyles = readFileSync('src/renderer/assets/styles/markdown.css', 'utf8')

describe('markdown image capture styles', () => {
  it('unclips inline and block formula bounds while capturing', () => {
    const expectedSelectors = [
      '[data-image-capturing] .katex',
      '[data-image-capturing] .katex-display',
      '[data-image-capturing] mjx-container'
    ]
    let captureRule: Rule | undefined

    postcss.parse(markdownStyles).walkRules((rule) => {
      if (expectedSelectors.every((selector) => rule.selectors.includes(selector))) {
        captureRule = rule
      }
    })

    // The capture marker is the layout contract; static exports cannot scroll clipped formula boxes.
    const overflow = captureRule?.nodes.find((node) => node.type === 'decl' && node.prop === 'overflow')
    expect(overflow).toMatchObject({ value: 'visible', important: true })
  })
})
