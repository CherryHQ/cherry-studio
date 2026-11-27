import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { CodeStyleContext, type useCodeStyle } from '@renderer/hooks/useCodeStyle'

import CodeViewer from '../CodeViewer'

const descriptors = Object.getOwnPropertyDescriptors(HTMLElement.prototype)
const frames = new Map<number, FrameRequestCallback>()
let nextFrame = 0

beforeEach(() => {
  MockUsePreferenceUtils.resetMocks()
  MockUsePreferenceUtils.setMultiplePreferenceValues({
    'chat.code.show_line_numbers': false,
    'chat.message.font_size': 14
  })
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.set(++nextFrame, callback)
    return nextFrame
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    frames.delete(id)
  })
  Object.defineProperties(HTMLElement.prototype, {
    clientWidth: { configurable: true, get: () => 600 },
    clientHeight: { configurable: true, get: () => 300 },
    offsetWidth: { configurable: true, get: () => 600 },
    offsetHeight: {
      configurable: true,
      get() {
        return this.hasAttribute('data-index') ? 21 : 300
      }
    },
    scrollHeight: { configurable: true, get: () => 300 },
    scrollTo: {
      configurable: true,
      value({ top }: ScrollToOptions) {
        this.scrollTop = top ?? 0
      }
    }
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    top: 0,
    bottom: 300,
    left: 0,
    right: 600,
    width: 600,
    height: 300,
    x: 0,
    y: 0,
    toJSON() {}
  })
})

afterEach(() => {
  cleanup()
  frames.clear()
  vi.restoreAllMocks()
  for (const key of ['clientWidth', 'clientHeight', 'offsetWidth', 'offsetHeight', 'scrollHeight', 'scrollTo']) {
    const descriptor = descriptors[key]
    if (descriptor) Object.defineProperty(HTMLElement.prototype, key, descriptor)
    else Reflect.deleteProperty(HTMLElement.prototype, key)
  }
})

async function paintFrame() {
  await act(async () => {
    const ready = [...frames.values()]
    frames.clear()
    for (const callback of ready) callback(performance.now())
  })
}

it('paints readable plain code before applying even immediately ready syntax', async () => {
  const source = 'const answer = 42'
  const context: ReturnType<typeof useCodeStyle> = {
    activeCodeTheme: 'github-light',
    activeCmTheme: 'light',
    isCodeThemeDark: false,
    codeThemes: ['github-light', 'github-dark'],
    requestCmTheme() {},
    cleanupTokenizers() {},
    highlightCode: async () => '',
    renderMarkdown: async () => '',
    highlightRange: async () => ({ start: 0, lines: [[{ content: source, offset: 0, className: 'ready-syntax' }]] })
  }
  const view = render(
    <CodeStyleContext value={context}>
      <CodeViewer value={source} language="typescript" expanded={false} height={300} />
    </CodeStyleContext>
  )
  await act(async () => {})
  expect(view.container.querySelector('.line-content')?.textContent).toBe(source)
  expect(view.container.querySelector('.ready-syntax')).toBeNull()

  await paintFrame()
  expect(view.container.querySelector('.line-content')?.textContent).toBe(source)
  expect(view.container.querySelector('.ready-syntax')).toBeNull()

  await paintFrame()
  expect(view.container.querySelector('.ready-syntax')?.textContent).toBe(source)
})
