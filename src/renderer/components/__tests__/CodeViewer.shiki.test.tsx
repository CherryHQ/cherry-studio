// @vitest-environment jsdom
import { readFileSync } from 'node:fs'

import { render } from '@testing-library/react'
import postcss, { type Rule } from 'postcss'
import { expect, it, vi } from 'vitest'

import CodeViewer from '../CodeViewer'

const captureHighlight = vi.hoisted(() => ({ read: vi.fn(), cleanup: vi.fn() }))
vi.mock('@renderer/hooks/useCodeStyle', () => ({
  useCodeStyle: () => ({
    isCodeThemeDark: false,
    highlightRange: captureHighlight.read,
    cleanupTokenizers: captureHighlight.cleanup
  })
}))
vi.mock('@renderer/hooks/useCodeHighlight', () => ({
  useCodeHighlight: () => ({ tokens: null, highlightLines, resetHighlight })
}))
const highlightLines = async () => {}
const resetHighlight = () => {}

it('keeps ligature suppression on the class the fenced-code renderer actually emits', () => {
  const { container } = render(<CodeViewer value={'x =~ 42\ny <= 10 -> z'} language="text" expanded={false} />)
  const element = container.firstElementChild!
  const matchingRules: Rule[] = []
  const css = readFileSync('src/renderer/assets/styles/markdown.css', 'utf8')

  postcss.parse(css).walkRules((rule) => {
    if (
      rule.selectors.some((selector) => {
        try {
          return element.matches(selector)
        } catch {
          return false
        }
      })
    ) {
      matchingRules.push(rule)
    }
  })

  // Fenced blocks must retain the stylesheet's ligature suppression without replacing inherited features.
  expect(matchingRules.some((rule) => rule.selectors.includes('.shiki'))).toBe(true)
  const declarations = matchingRules.flatMap((rule) => rule.nodes.filter((node) => node.type === 'decl'))
  expect(
    declarations.some((declaration) => declaration.prop === 'font-variant-ligatures' && declaration.value === 'none')
  ).toBe(true)
  expect(declarations.some((declaration) => declaration.prop === 'font-feature-settings')).toBe(false)
})
