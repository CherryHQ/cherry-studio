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

describe('markdown table styles', () => {
  it('preserves word boundaries in intrinsically sized cells', () => {
    let tableCellRule: Rule | undefined

    postcss.parse(markdownStyles).walkRules((rule) => {
      if (rule.selectors.includes('.markdown th') && rule.selectors.includes('.markdown td')) {
        tableCellRule = rule
      }
    })

    const declarations = Object.fromEntries(
      tableCellRule?.nodes
        .filter((node) => node.type === 'decl')
        .map((declaration) => [declaration.prop, declaration.value]) ?? []
    )

    expect(declarations).toMatchObject({
      'overflow-wrap': 'break-word',
      'word-break': 'normal'
    })
  })
})
