import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

function Harness({
  initialText = '',
  markdownLivePreview,
  suggestion = '',
  onSend = () => undefined
}: {
  initialText?: string
  markdownLivePreview?: boolean
  suggestion?: string
  onSend?: () => void
}) {
  const [text, setText] = useState(initialText)
  const [dismissed, setDismissed] = useState(false)
  return (
    <>
      <input aria-label="Other input" />
      <output aria-label="Stored draft">{text}</output>
      <ComposerSurface
        markdownLivePreview={markdownLivePreview}
        text={text}
        onTextChange={setText}
        tokens={tokens}
        managedTokenKinds={[]}
        onTokensChange={() => undefined}
        placeholder="Painting prompt"
        promptSuggestion={!text && !dismissed ? suggestion : ''}
        onDismissPromptSuggestion={() => setDismissed(true)}
        sendMessageShortcut={['Enter']}
        sendDisabled={!text}
        isLoading={false}
        onSendDraft={onSend}
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

it('accepts a cold suggestion as editable text without sending it', async () => {
  const user = userEvent.setup()
  const send = vi.fn()
  render(<Harness suggestion="Run the tests." onSend={send} />)
  const fallback = screen.getByRole('textbox', { name: 'Painting prompt' })
  expect(screen.getByLabelText('Stored draft')).toBeEmptyDOMElement()
  await user.click(fallback)
  await user.keyboard('{Tab}')
  expect(screen.getByLabelText('Stored draft')).toHaveTextContent('Run the tests.')
  expect(send).not.toHaveBeenCalled()
})

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

it('applies a Markdown preview toggle to an editor that is already mounted', async () => {
  const view = render(<Harness initialText="**bold**" />)
  runtime.resolve()
  await act(() => vi.dynamicImportSettled())
  const editor = () => view.container.querySelector('[data-ui~="part:composer-input"] [contenteditable="true"]')
  await waitFor(() => expect(editor()?.textContent).toBe('**bold**'))
  expect(editor()?.querySelector('.composer-md-strong')).toBeNull()

  view.rerender(<Harness initialText="**bold**" markdownLivePreview />)
  await waitFor(() => expect(editor()?.querySelector('.composer-md-strong')).not.toBeNull())

  view.rerender(<Harness initialText="**bold**" markdownLivePreview={false} />)
  await waitFor(() => expect(editor()?.querySelector('.composer-md-strong')).toBeNull())
  expect(editor()?.textContent).toBe('**bold**')
  expect(screen.getByLabelText('Stored draft').textContent).toBe('**bold**')
})

it('accepts a rich-editor suggestion literally and leaves it editable without sending', async () => {
  const user = userEvent.setup()
  const send = vi.fn()
  const suggestion = 'Explain <button> and **bold**.'
  const view = render(<Harness suggestion={suggestion} onSend={send} />)
  await user.click(screen.getByRole('textbox', { name: 'Painting prompt' }))
  runtime.resolve()
  await act(() => vi.dynamicImportSettled())
  await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Painting prompt' })).not.toBeInTheDocument())
  const editor = view.container.querySelector<HTMLElement>('[data-ui~="part:composer-input"] [contenteditable="true"]')!
  expect(editor).toHaveFocus()
  await user.keyboard('{Tab}')
  await flushFrame()
  expect(screen.getByLabelText('Stored draft').textContent).toBe(suggestion)
  expect(editor.textContent).toBe(suggestion)
  expect(send).not.toHaveBeenCalled()
  await user.keyboard('K')
  await flushFrame()
  expect(screen.getByLabelText('Stored draft').textContent).toBe(`${suggestion}K`)
})

it('dismisses on Escape and does not accept while an IME is composing', async () => {
  const user = userEvent.setup()
  const view = render(<Harness suggestion="Run the tests." />)
  await user.click(screen.getByRole('textbox', { name: 'Painting prompt' }))
  runtime.resolve()
  await act(() => vi.dynamicImportSettled())
  await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Painting prompt' })).not.toBeInTheDocument())
  const editor = view.container.querySelector<HTMLElement>('[data-ui~="part:composer-input"] [contenteditable="true"]')!
  expect(editor).toHaveFocus()
  fireEvent.keyDown(editor, { key: 'Tab', isComposing: true })
  expect(screen.getByLabelText('Stored draft')).toBeEmptyDOMElement()
  expect(screen.getByText('Run the tests.')).toBeInTheDocument()
  await user.keyboard('{Escape}')
  expect(screen.queryByText('Run the tests.')).not.toBeInTheDocument()
  await user.keyboard('{Tab}')
  expect(screen.getByLabelText('Stored draft')).toBeEmptyDOMElement()
})
