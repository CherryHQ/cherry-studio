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

function specificity(selector: string): number[] {
  const score = [0, 0, 0]
  const tokens = /#[\w-]+|\.[\w-]+|\[[^\]]+\]|::[\w-]+|:[\w-]+|[a-zA-Z_][\w-]*|[(),]/g
  let token: RegExpExecArray | null
  while ((token = tokens.exec(selector))) {
    const part = token[0]
    if (/^:(is|not|where)$/.test(part) && selector[tokens.lastIndex] === '(') {
      const start = ++tokens.lastIndex
      let depth = 1
      while (depth && tokens.lastIndex < selector.length) {
        const char = selector[tokens.lastIndex++]
        if (char === '(') depth++
        if (char === ')') depth--
      }
      if (part !== ':where') {
        const argumentsScores = postcss.list.comma(selector.slice(start, tokens.lastIndex - 1)).map(specificity)
        const max = argumentsScores.reduce((a, b) => (compare(a, b) >= 0 ? a : b))
        max.forEach((value, i) => (score[i] += value))
      }
    } else if (part.startsWith('#')) score[0]++
    else if (part.startsWith('::')) score[2]++
    else if (/^[.[:]/.test(part)) score[1]++
    else if (/^[a-zA-Z_]/.test(part)) score[2]++
  }
  return score
}

function compare(a: number[], b: number[]): number {
  const index = a.findIndex((part, i) => part !== b[i])
  return index < 0 ? 0 : a[index] - b[index]
}

function resolveStyle(element: Element, property: string, styles = stylesheet): string | null {
  let winner: { value: string; priority: number[] } | null = null
  styles.walkRules((rule) => {
    for (const selector of rule.selectors) {
      try {
        if (!element.matches(selector)) continue
      } catch {
        continue
      }
      rule.walkDecls(property, (declaration) => {
        const priority = [declaration.important ? 1 : 0, ...specificity(selector)]
        if (!winner || compare(priority, winner.priority) >= 0) {
          winner = { value: declaration.value, priority }
        }
      })
    }
  })
  const result = winner as { value: string } | null
  return result?.value ?? (element.parentElement ? resolveStyle(element.parentElement, property, styles) : null)
}

it('resolves cascade priority for matched selectors', () => {
  const element = document.createElement('div')
  element.id = 'target'
  element.className = 'a b c'
  element.setAttribute('data-test', '')
  const styles = postcss.parse(`
    #target { --important: high; --specific: high; }
    .a { --important: important !important; --specific: low; --equal: first; }
    .b { --equal: later; }
    :is(.a, .b.c) { --is: maximum; }
    .a { --is: lower; --where: higher; --list: matched; }
    :where(.a) { --where: zero; }
    #missing, div { --list: lower; }
    [data-test]:not(.missing) { --attribute: higher; }
    .a { --attribute: lower; }
  `)
  for (const [property, value] of Object.entries({
    important: 'important',
    specific: 'high',
    equal: 'later',
    is: 'maximum',
    where: 'higher',
    list: 'matched',
    attribute: 'higher'
  })) {
    expect(resolveStyle(element, `--${property}`, styles)).toBe(value)
  }
})

it('resolves ligature suppression on the elements that render code', () => {
  const { container } = render(<CodeViewer value={'x =~ 42\n<='} language="text" expanded={false} />)
  const textElement = Array.from(container.querySelectorAll('.shiki .line-content > span')).find(
    (element) => element.textContent?.trim() === '<='
  )!
  expect(textElement).toBeDefined()

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
