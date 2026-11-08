// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import * as Barrel from '../index'

const { loadImplementation } = vi.hoisted(() => ({ loadImplementation: vi.fn() }))

vi.mock('../composites/code-editor/code-editor', async () => {
  loadImplementation()
  return new Promise(() => {})
})

afterEach(cleanup)

it('preserves the public editor API without evaluating CodeMirror until mounted', () => {
  expect(Barrel.CodeEditor).toBeDefined()
  expect(loadImplementation).not.toHaveBeenCalled()
  const view = render(<Barrel.CodeEditor value="source" language="text" />)
  expect(view.getByText('source').getAttribute('aria-busy')).toBe('true')
})

it.each(['', 'long source\\n'.repeat(100)])(
  'keeps collapsed loading content inside the editor size constraints',
  (value) => {
    const view = render(
      <Barrel.CodeEditor
        value={value}
        language="text"
        expanded={false}
        height="100%"
        minHeight="80px"
        maxHeight="200px"
        className="caller-editor"
      />
    )
    // These dimensions are the editor's documented loading-layout contract.
    const fallback = view.container.querySelector('pre')!
    expect(fallback.style.height).toBe('100%')
    expect(fallback.style.minHeight).toBe('80px')
    expect(fallback.style.maxHeight).toBe('200px')
    expect(fallback.style.overflow).toBe('auto')
    expect(fallback.classList.contains('caller-editor')).toBe(true)
  }
)

it('ignores collapsed dimensions when the loading editor is expanded', () => {
  const view = render(
    <Barrel.CodeEditor value="expanded" language="text" height="20px" maxHeight="30px" minHeight="40px" />
  )
  const fallback = view.getByText('expanded')
  expect(fallback.style.height).toBe('')
  expect(fallback.style.maxHeight).toBe('')
  expect(fallback.style.minHeight).toBe('40px')
})
