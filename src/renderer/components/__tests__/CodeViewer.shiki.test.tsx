// @vitest-environment jsdom
import { readFileSync } from 'node:fs'

import { render } from '@testing-library/react'
import postcss from 'postcss'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

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

const originalDescriptors = Object.getOwnPropertyDescriptors(HTMLElement.prototype)
beforeEach(() => {
  Object.defineProperties(HTMLElement.prototype, {
    offsetWidth: { configurable: true, get: () => 640 },
    offsetHeight: { configurable: true, get: () => 300 }
  })
})
afterEach(() => {
  for (const key of ['offsetWidth', 'offsetHeight']) {
    Object.defineProperty(HTMLElement.prototype, key, originalDescriptors[key])
  }
})

const stylesheet = postcss.parse(readFileSync('src/renderer/assets/styles/markdown.css', 'utf8'))

function resolveStyle(element: Element, property: string): string | null {
  let winner: { value: string; priority: number[] } | null = null
  stylesheet.walkRules((rule) => {
    for (const selector of rule.selectors) {
      try {
        if (!element.matches(selector)) continue
      } catch {
        continue
      }
      const unwrapped = selector.replace(/:is\(([^()]*)\)/g, '$1')
      const ids = unwrapped.match(/#[\w-]+/g)?.length ?? 0
      const classes = unwrapped.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g)?.length ?? 0
      const types =
        unwrapped
          .replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|:{1,2}[\w-]+(?:\([^)]*\))?/g, '')
          .match(/(?:^|[\s>+~])([a-zA-Z][\w-]*)/g)?.length ?? 0
      rule.walkDecls(property, (declaration) => {
        const priority = [Number(declaration.important), ids, classes, types]
        if (
          !winner ||
          priority.some(
            (part, i) => part > winner!.priority[i] && priority.slice(0, i).every((v, j) => v === winner!.priority[j])
          ) ||
          priority.every((part, i) => part === winner!.priority[i])
        ) {
          winner = { value: declaration.value, priority }
        }
      })
    }
  })
  const result = winner as { value: string } | null
  return result?.value ?? (element.parentElement ? resolveStyle(element.parentElement, property) : null)
}

it('resolves ligature suppression on the elements that render code', () => {
  const { container } = render(<CodeViewer value={'x =~ 42\ny <= 10 -> z'} language="text" expanded={false} />)
  const root = container.querySelector('.shiki')!
  const textElement =
    container.querySelector('.shiki .line-content') ??
    Array.from(root.querySelectorAll('*'))
      .reverse()
      .find((element) => element.textContent?.includes('<='))!

  // The contract is that .markdown code matches inline code, regardless of its producer.
  const inline = render(
    <div className="markdown">
      <code>x &lt;= y</code>
      <p>plain text</p>
    </div>
  )
  expect(resolveStyle(textElement, 'font-variant-ligatures')).toBe('none')
  expect(resolveStyle(inline.container.querySelector('code')!, 'font-variant-ligatures')).toBe('none')
  expect(resolveStyle(inline.container.querySelector('p')!, 'font-variant-ligatures')).toBeNull()
})
