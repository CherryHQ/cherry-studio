// @vitest-environment jsdom

/**
 * Regression tests for the formula-copy regression (#18698, #18665).
 *
 * KaTeX's copy-tex contrib attaches a document-level `copy` listener at import
 * time, so the styles entry (`../styles`, which side-effect-imports copy-tex)
 * must survive the production bundle. `packages/ui/package.json` previously
 * whitelisted only CSS files in `sideEffects`, and the bundler tree-shook the
 * whole styles entry out of release builds: the listener never registered and
 * mouse-selection copy fell back to the flattened visual text (superscripts
 * lost, TeX gone). These tests pin both halves of the contract: the entry
 * actually wires the copy behavior, and the package manifest keeps it
 * un-shakeable.
 */

import '../styles'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Markdown } from '../markdown'
import { withChatPlugins } from '../presets'

function dispatchCopy(): ReturnType<typeof vi.fn> {
  const setData = vi.fn()
  const event = new Event('copy', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: { setData } })
  document.dispatchEvent(event)
  return setData
}

function selectAllOf(element: Element): void {
  const range = document.createRange()
  range.selectNodeContents(element)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

describe('markdown styles entry', () => {
  it('restores TeX with delimiters when a selection over formulas is copied', () => {
    const { container } = render(
      <Markdown id="copy-tex" plugins={withChatPlugins()}>
        {'before $x^2$ mid\n\n$$\n(a+b)^2\n$$'}
      </Markdown>
    )
    const root = container.querySelector('.markdown')
    expect(root?.querySelector('math')).not.toBeNull()

    selectAllOf(root!)
    const setData = dispatchCopy()

    expect(setData).toHaveBeenCalledWith('text/plain', 'before $x^2$ mid\n$$(a+b)^2$$')
    // The html flavor keeps the rendered markup so pasting into Word still works.
    expect(setData).toHaveBeenCalledWith('text/html', expect.stringContaining('<math'))
  })

  it('keeps the styles entry covered by the package sideEffects manifest', () => {
    // vitest may run with the package or the repo root as cwd; find @cherrystudio/ui's manifest either way
    const pkgPath = [resolve(process.cwd(), 'package.json'), resolve(process.cwd(), 'packages/ui/package.json')].find(
      (candidate) => {
        try {
          return (JSON.parse(readFileSync(candidate, 'utf8')) as { name?: string }).name === '@cherrystudio/ui'
        } catch {
          return false
        }
      }
    )
    expect(pkgPath, 'could not locate packages/ui/package.json').toBeDefined()
    const pkg = JSON.parse(readFileSync(pkgPath!, 'utf8')) as { sideEffects?: string[] }
    expect(
      pkg.sideEffects,
      'styles.ts side-effect-imports katex copy-tex; without a sideEffects entry the bundler drops it from release builds'
    ).toContain('./src/components/composites/markdown/styles.ts')
  })
})
