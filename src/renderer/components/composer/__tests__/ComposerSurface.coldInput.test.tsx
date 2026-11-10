import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import ComposerSurface, { type ComposerSurfaceProps } from '../ComposerSurface'

const runtime = vi.hoisted(() => {
  let resolve!: () => void
  const ready = new Promise<void>((done) => {
    resolve = done
  })
  return { ready, resolve }
})

vi.mock('../ComposerSurfaceRuntime', async (importOriginal) => {
  await runtime.ready
  return importOriginal()
})

vi.mock('@renderer/components/QuickPanel', () => {
  const panel = {
    close: vi.fn(),
    dispatchKeyDown: () => false,
    getPanelGeneration: () => 0,
    isVisible: false,
    open: vi.fn(),
    updateList: vi.fn()
  }
  return { QuickPanelView: () => null, useQuickPanel: () => panel }
})

vi.mock('../ComposerToolRuntime', () => ({
  ComposerToolFooterActionsSync: () => null,
  ComposerToolMenu: () => null,
  useComposerPinnedTools: () => []
}))

const tokens: ComposerSurfaceProps['tokens'] = []
const idleDescriptor = Object.getOwnPropertyDescriptor(window, 'requestIdleCallback')
const cancelIdleDescriptor = Object.getOwnPropertyDescriptor(window, 'cancelIdleCallback')
const rangeRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects')
const rangeBounds = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')
let frames: Map<number, FrameRequestCallback>
let idleCallbacks: (() => void)[]

beforeEach(() => {
  MockUsePreferenceUtils.resetMocks()
  frames = new Map()
  idleCallbacks = []
  let frameId = 0
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.set(++frameId, callback)
    return frameId
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    frames.delete(id)
  })
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  Object.defineProperties(window, {
    requestIdleCallback: { configurable: true, value: (callback: () => void) => idleCallbacks.push(callback) },
    cancelIdleCallback: { configurable: true, value: () => undefined }
  })
  Object.defineProperties(Range.prototype, {
    getClientRects: { configurable: true, value: () => [] },
    getBoundingClientRect: { configurable: true, value: () => new DOMRect() }
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  for (const [target, key, descriptor] of [
    [window, 'requestIdleCallback', idleDescriptor],
    [window, 'cancelIdleCallback', cancelIdleDescriptor],
    [Range.prototype, 'getClientRects', rangeRects],
    [Range.prototype, 'getBoundingClientRect', rangeBounds]
  ] as const) {
    if (descriptor) Object.defineProperty(target, key, descriptor)
    else Reflect.deleteProperty(target, key)
  }
})

function Harness() {
  const [text, setText] = useState('')
  return (
    <>
      <input aria-label="Other input" />
      <output aria-label="Stored draft">{text}</output>
      <ComposerSurface
        text={text}
        onTextChange={setText}
        tokens={tokens}
        managedTokenKinds={[]}
        onTokensChange={() => undefined}
        placeholder="Painting prompt"
        sendMessageShortcut={['Enter']}
        sendDisabled
        isLoading={false}
        onSendDraft={() => undefined}
        onPause={() => undefined}
        supportedExts={[]}
        setFiles={() => undefined}
        filesCount={0}
        isExpanded={false}
        onExpandedChange={() => undefined}
        quickPanelEnabled={false}
        enableDragDrop={false}
        enableSpellCheck={false}
        fontSize={14}
        narrowMode
      />
    </>
  )
}

async function flushFrame() {
  await act(async () => {
    const pending = [...frames.values()]
    frames.clear()
    pending.forEach((callback) => callback(performance.now()))
  })
}

it('focuses the real editor before the next frame and retains its first typed character', async () => {
  const user = userEvent.setup()
  const { container } = render(<Harness />)
  const fallback = screen.getByRole('textbox', { name: 'Painting prompt' })
  await user.click(fallback)
  expect(fallback).toHaveFocus()

  runtime.resolve()
  await act(() => vi.dynamicImportSettled())
  await waitFor(() => expect(fallback).not.toBeInTheDocument())
  const editor = container.querySelector('[data-ui~="part:composer-input"] [contenteditable="true"]')
  expect(editor).toHaveFocus()

  await user.keyboard('K')
  await flushFrame()

  await waitFor(() => {
    expect(editor?.textContent).toBe('K')
    expect(screen.getByLabelText('Stored draft').textContent).toBe('K')
  })
})

it('retains the same first typed character in an already focused real editor', async () => {
  const user = userEvent.setup()
  const { container } = render(<Harness />)
  const fallback = screen.getByRole('textbox', { name: 'Painting prompt' })
  await user.click(fallback)
  runtime.resolve()
  await act(() => vi.dynamicImportSettled())
  await waitFor(() => expect(fallback).not.toBeInTheDocument())
  await flushFrame()
  const editor = container.querySelector('[data-ui~="part:composer-input"] [contenteditable="true"]')
  expect(editor).toHaveFocus()

  await user.keyboard('K')
  await flushFrame()

  await waitFor(() => {
    expect(editor?.textContent).toBe('K')
    expect(screen.getByLabelText('Stored draft').textContent).toBe('K')
  })
})

it('preserves another input focus when an untouched fallback loads the real editor while idle', async () => {
  const user = userEvent.setup()
  const { container } = render(<Harness />)
  const fallback = screen.getByRole('textbox', { name: 'Painting prompt' })
  const otherInput = screen.getByRole('textbox', { name: 'Other input' })
  await user.click(otherInput)
  await act(async () => {
    idleCallbacks.forEach((callback) => callback())
    runtime.resolve()
    await vi.dynamicImportSettled()
  })
  await waitFor(() => expect(fallback).not.toBeInTheDocument())
  await flushFrame()
  expect(otherInput).toHaveFocus()
  await user.keyboard('Other draft')
  expect(otherInput).toHaveValue('Other draft')
  expect(container.querySelector('[data-ui~="part:composer-input"] [contenteditable="true"]')?.textContent).toBe('')
  expect(screen.getByLabelText('Stored draft')).toBeEmptyDOMElement()
})
