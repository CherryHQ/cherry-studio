import { MockUseDataApiUtils, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CommandSharedPreferencesContext } from '@renderer/hooks/command'
import { toast } from '@renderer/services/toast'
import type * as TranslateUtils from '@renderer/utils/translate'
import { translateText } from '@renderer/utils/translate'
import { getDefaultValue } from '@shared/data/preference/preferenceUtils'
import { BUILTIN_TRANSLATE_LANGUAGES } from '@shared/data/presets/translateLanguages'

import SelectionContextMenu from '../SelectionContextMenu'

vi.unmock('@cherrystudio/ui')
vi.mock('react-i18next', async () => {
  const { default: en } = await import('@renderer/i18n/locales/en-us.json')
  return {
    useTranslation: () => ({
      t: (key: string) => (key.startsWith('translate.error.') ? en[key as keyof typeof en] : key)
    })
  }
})
vi.mock('@renderer/utils/translate', async (importOriginal) => ({
  ...(await importOriginal<typeof TranslateUtils>()),
  translateText: vi.fn()
}))

function contentView() {
  return (
    <CommandSharedPreferencesContext value={{ menuPresentationMode: 'cherry', shortcutPreferences: {} }}>
      <SelectionContextMenu>
        <div>
          <p>Selected message text</p>
          <p>Same Same</p>
          <div contentEditable suppressContentEditableWarning>
            Editable draft
          </div>
        </div>
      </SelectionContextMenu>
      <p>Outside content</p>
    </CommandSharedPreferencesContext>
  )
}

function renderContent() {
  return render(contentView())
}

function pendingTranslation() {
  let resolve!: (text: string) => void
  let reject!: (error: Error) => void
  const promise = new Promise<string>((res, rej) => {
    resolve = res
    reject = rej
  })
  let onResponse!: NonNullable<Parameters<typeof translateText>[2]>
  let signal!: AbortSignal
  vi.mocked(translateText).mockImplementationOnce((_text, _target, respond, abortSignal) => {
    onResponse = respond!
    signal = abortSignal!
    return promise
  })
  return {
    resolve,
    reject,
    respond: (text: string) => onResponse(text, false),
    signal: () => signal
  }
}

async function selectText(element: HTMLElement, endElement = element, duringSelection?: () => void) {
  fireEvent(element, new MouseEvent('pointerdown', { button: 0, bubbles: true }))
  const range = document.createRange()
  range.setStart(element.firstChild!, 0)
  range.setEnd(endElement.firstChild!, endElement.textContent.length)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  fireEvent(document, new Event('selectionchange'))
  expect(screen.queryByRole('button', { name: 'common.copy' })).not.toBeInTheDocument()
  duringSelection?.()
  fireEvent(endElement, new MouseEvent('pointerup', { button: 0, bubbles: true }))
  await act(() => new Promise((resolve) => requestAnimationFrame(resolve)))
}

describe('automatic selected-text actions', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.mocked(toast.error).mockClear()
    MockUseDataApiUtils.resetMocks()
    MockUseDataApiUtils.mockQueryLoading('/translate/languages')
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.translate.selection_toolbar.enabled': getDefaultValue('feature.translate.selection_toolbar.enabled'),
      'feature.translate.page.target_language': 'zh-cn'
    })
    vi.mocked(translateText).mockReset().mockResolvedValue('Translated selection')
    window.getSelection()?.removeAllRanges()
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => new DOMRect(100, 100, 180, 20)
    })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) }
    })
    window.api.quoteToMainWindow = vi.fn().mockResolvedValue(undefined)
  })

  it('copies and quotes a completed selection without opening the context menu', async () => {
    const user = userEvent.setup()
    renderContent()
    const content = screen.getByText('Selected message text')
    await selectText(content)

    await user.click(await screen.findByRole('button', { name: 'common.copy' }))
    expect(await navigator.clipboard.readText()).toBe('Selected message text')
    expect(window.getSelection()?.toString()).toBe('Selected message text')
    await waitFor(() => expect(screen.queryByRole('button', { name: 'chat.message.quote' })).not.toBeInTheDocument())

    await selectText(content)
    await user.click(await screen.findByRole('button', { name: 'chat.message.quote' }))
    expect(window.api.quoteToMainWindow).toHaveBeenCalledWith('Selected message text')
  })

  it('excludes editable content, outside selections, and selections crossing the scope boundary', async () => {
    renderContent()
    await selectText(screen.getByText('Editable draft'))
    expect(screen.queryByRole('button', { name: 'common.copy' })).not.toBeInTheDocument()
    await selectText(screen.getByText('Outside content'))
    expect(screen.queryByRole('button', { name: 'common.copy' })).not.toBeInTheDocument()
    await selectText(screen.getByText('Selected message text'), screen.getByText('Outside content'))
    expect(screen.queryByRole('button', { name: 'common.copy' })).not.toBeInTheDocument()
  })

  it('shows actions after completing a drag that scrolls the message', async () => {
    renderContent()
    const content = screen.getByText('Selected message text')
    await selectText(content, content, () => fireEvent.scroll(content))
    expect(await screen.findByRole('button', { name: 'common.copy' })).toBeInTheDocument()
  })

  it('updates the measured anchor when an open selection grows', async () => {
    let selectionRect = new DOMRect(100, 100, 80, 20)
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => selectionRect
    })
    renderContent()
    const content = screen.getByText('Selected message text')
    await selectText(content, content, () => window.getSelection()!.getRangeAt(0).setEnd(content.firstChild!, 8))
    const popup = await screen.findByRole('dialog')
    // Radix exposes the measured anchor width that drives the open popup's positioning.
    const anchorWidth = () => popup.parentElement?.style.getPropertyValue('--radix-popper-anchor-width')
    await waitFor(() => expect(anchorWidth()).toBe('80px'))

    selectionRect = new DOMRect(100, 100, 210, 20)
    window.getSelection()!.getRangeAt(0).setEnd(content.firstChild!, content.textContent.length)
    fireEvent(document, new Event('selectionchange'))

    await waitFor(() => expect(anchorWidth()).toBe('210px'))
  })

  it('keeps actions hidden until keyboard selection and scrolling finish', async () => {
    renderContent()
    const content = screen.getByText('Selected message text')
    await selectText(content, content, () => window.getSelection()!.getRangeAt(0).setEnd(content.firstChild!, 8))
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.keyDown(document, { key: 'ArrowDown', shiftKey: true })
    window.getSelection()!.getRangeAt(0).setEnd(content.firstChild!, content.textContent.length)
    fireEvent(document, new Event('selectionchange'))
    expect(screen.queryByRole('button', { name: 'common.copy' })).not.toBeInTheDocument()
    fireEvent.scroll(content)
    expect(screen.queryByRole('button', { name: 'common.copy' })).not.toBeInTheDocument()
    fireEvent.keyUp(document, { key: 'ArrowDown', shiftKey: true })
    expect(await screen.findByRole('button', { name: 'common.copy' })).toBeInTheDocument()
  })

  it('keeps a completed keyboard selection actionable when it follows pointer release in the same frame', async () => {
    renderContent()
    const content = screen.getByText('Selected message text')
    fireEvent(content, new MouseEvent('pointerdown', { button: 0, bubbles: true }))
    const range = document.createRange()
    range.setStart(content.firstChild!, 0)
    range.setEnd(content.firstChild!, 1)
    window.getSelection()!.addRange(range)
    fireEvent(content, new MouseEvent('pointerup', { button: 0, bubbles: true }))
    fireEvent.keyDown(content, { key: 'ArrowRight', shiftKey: true })
    range.setEnd(content.firstChild!, content.textContent.length)
    fireEvent.keyUp(content, { key: 'ArrowRight', shiftKey: true })
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)))
    fireEvent(document, new Event('selectionchange'))

    expect(window.getSelection()?.toString()).toBe('Selected message text')
    expect(await screen.findByRole('button', { name: 'common.copy' })).toBeVisible()
  })

  it('waits for selection keys to finish across modifier releases and consecutive gestures', async () => {
    renderContent()
    const content = screen.getByText('Selected message text')
    await selectText(content, content, () => window.getSelection()!.getRangeAt(0).setEnd(content.firstChild!, 8))
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.keyDown(document, { key: 'ArrowDown', ctrlKey: true, shiftKey: true })
    window.getSelection()!.getRangeAt(0).setEnd(content.firstChild!, 12)
    fireEvent(document, new Event('selectionchange'))
    fireEvent.keyUp(document, { key: 'Control', shiftKey: true })
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)))
    expect(screen.queryByRole('button', { name: 'common.copy' })).not.toBeInTheDocument()

    fireEvent.keyUp(document, { key: 'ArrowDown', shiftKey: true })
    fireEvent.keyDown(document, { key: 'ArrowRight', shiftKey: true })
    window.getSelection()!.getRangeAt(0).setEnd(content.firstChild!, content.textContent.length)
    fireEvent(document, new Event('selectionchange'))
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)))
    expect(screen.queryByRole('button', { name: 'common.copy' })).not.toBeInTheDocument()
    fireEvent.keyUp(document, { key: 'ArrowRight', shiftKey: true })
    expect(await screen.findByRole('button', { name: 'common.copy' })).toBeInTheDocument()
  })

  it.each(['escape', 'scroll', 'blur', 'collapse'] as const)('dismisses on %s', async (reason) => {
    renderContent()
    await selectText(screen.getByText('Selected message text'))
    await screen.findByRole('button', { name: 'common.copy' })
    if (reason === 'escape') fireEvent.keyDown(document, { key: 'Escape' })
    if (reason === 'scroll') fireEvent.scroll(screen.getByText('Selected message text'))
    if (reason === 'blur') fireEvent(window, new Event('blur'))
    if (reason === 'collapse') {
      window.getSelection()?.removeAllRanges()
      fireEvent(document, new Event('selectionchange'))
    }
    await waitFor(() => expect(screen.queryByRole('button', { name: 'common.copy' })).not.toBeInTheDocument())
  })
  it.each([false, true])('does not request languages before translating when enabled is %s', async (enabled) => {
    MockUsePreferenceUtils.setPreferenceValue('feature.translate.selection_toolbar.enabled', enabled)
    MockUseDataApiUtils.mockQueryResult('/translate/languages', { data: undefined, error: new Error('IPC down') })
    renderContent()
    await selectText(screen.getByText('Selected message text'))
    expect(screen.getByRole('button', { name: 'common.copy' })).toBeVisible()

    const queries = mockUseQuery.mock.calls.filter(([path]) => path === '/translate/languages')
    expect(queries.length).toBeGreaterThan(0)
    expect(queries.map(([, options]) => options?.enabled)).toEqual(queries.map(() => false))
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('requests languages on Translate and localizes the snapshotted target when data arrives', async () => {
    const user = userEvent.setup()
    const request = pendingTranslation()
    const view = renderContent()
    await selectText(screen.getByText('Selected message text'))
    const before = mockUseQuery.mock.calls.filter(([path]) => path === '/translate/languages').length
    expect(
      mockUseQuery.mock.calls.some(([path, options]) => path === '/translate/languages' && options?.enabled === true)
    ).toBe(false)
    await user.click(screen.getByRole('button', { name: 'translate.button.translate' }))

    expect(
      mockUseQuery.mock.calls
        .filter(([path]) => path === '/translate/languages')
        .slice(before)
        .some(([, options]) => options?.enabled === true)
    ).toBe(true)
    expect(translateText).toHaveBeenCalledWith(
      'Selected message text',
      'zh-cn',
      expect.any(Function),
      expect.any(AbortSignal)
    )
    expect(screen.getByText('translate.translate_to zh-cn')).toBeVisible()

    MockUsePreferenceUtils.setPreferenceValue('feature.translate.page.target_language', 'ja-jp')
    MockUseDataApiUtils.mockQueryData(
      '/translate/languages',
      BUILTIN_TRANSLATE_LANGUAGES.map((language) => ({
        ...language,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }))
    )
    view.rerender(contentView())
    expect(screen.getByText('translate.translate_to languages.chinese')).toBeVisible()
    await act(async () => request.resolve('Translated selection'))
    expect(screen.getByText('Translated selection')).toBeVisible()
  })

  it('renders the translation with a language code and one toast when languages fail to load', async () => {
    const user = userEvent.setup()
    MockUseDataApiUtils.mockQueryResult('/translate/languages', { data: undefined, error: new Error('IPC down') })
    renderContent()
    await selectText(screen.getByText('Selected message text'))
    await user.click(screen.getByRole('button', { name: 'translate.button.translate' }))

    expect(translateText).toHaveBeenCalledWith(
      'Selected message text',
      'zh-cn',
      expect.any(Function),
      expect.any(AbortSignal)
    )
    expect(await screen.findByText('Translated selection')).toBeVisible()
    expect(screen.getByText('translate.translate_to zh-cn')).toBeVisible()
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(
      'Failed to load translate languages. Some features may be unavailable.'
    )
  })

  it('reports a language load failure once on a page with two selection menus', async () => {
    const user = userEvent.setup()
    MockUseDataApiUtils.mockQueryResult('/translate/languages', { data: undefined, error: new Error('IPC down') })
    const first = renderContent()
    renderContent()
    await selectText(within(first.container).getByText('Selected message text'))
    await user.click(screen.getByRole('button', { name: 'translate.button.translate' }))

    expect(await screen.findByText('Translated selection')).toBeVisible()
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(
      'Failed to load translate languages. Some features may be unavailable.'
    )
  })

  // RED: a missing Translate entry or runAction dismissal loses the inline result and original selection.
  it('translates the selected text in the same popover and returns to the original actions', async () => {
    const user = userEvent.setup()
    renderContent()
    await selectText(screen.getByText('Selected message text'))
    const popover = screen.getByRole('dialog')
    await user.click(screen.getByRole('button', { name: 'translate.button.translate' }))
    expect(await screen.findByText('Translated selection')).toBeVisible()
    expect(screen.getByRole('dialog')).toBe(popover)
    expect(window.getSelection()?.toString()).toBe('Selected message text')
    await user.click(screen.getByRole('button', { name: 'common.back' }))
    await user.click(screen.getByRole('button', { name: 'chat.message.quote' }))
    expect(window.api.quoteToMainWindow).toHaveBeenCalledWith('Selected message text')
  })

  // RED: appending accumulated chunks produces AAB, and copying before completion exposes partial output.
  it('replaces accumulated streaming content and only enables copy on success', async () => {
    const user = userEvent.setup()
    const request = pendingTranslation()
    renderContent()
    await selectText(screen.getByText('Selected message text'))
    await user.click(screen.getByRole('button', { name: 'translate.button.translate' }))
    expect(screen.getByText('translate.processing')).toBeVisible()
    expect(screen.getByRole('button', { name: 'common.copy' })).toBeDisabled()
    act(() => request.respond('A'))
    expect(screen.getByText('A')).toBeVisible()
    act(() => request.respond('AB'))
    expect(screen.getByText('AB')).toBeVisible()
    await act(async () => request.resolve('AB'))
    expect(screen.getByText('AB')).toBeVisible()
    expect(screen.queryByText('AAB')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.copy' })).toBeEnabled()
  })

  // RED: reading the target again during a request changes its label; unknown must never reach translateText.
  it.each([
    ['zh-cn', 'zh-cn'],
    ['unknown', 'en-us']
  ])('snapshots target %s as %s', async (target, actual) => {
    const user = userEvent.setup()
    const request = pendingTranslation()
    if (target === 'zh-cn') {
      MockUseDataApiUtils.mockQueryData(
        '/translate/languages',
        BUILTIN_TRANSLATE_LANGUAGES.map((language) => ({
          ...language,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }))
      )
    }
    MockUsePreferenceUtils.setPreferenceValue('feature.translate.page.target_language', target)
    const view = renderContent()
    await selectText(screen.getByText('Selected message text'))
    await user.click(screen.getByRole('button', { name: 'translate.button.translate' }))
    expect(translateText).toHaveBeenCalledWith(
      'Selected message text',
      actual,
      expect.any(Function),
      expect.any(AbortSignal)
    )
    const expectedLabel =
      target === 'zh-cn' ? 'translate.translate_to languages.chinese' : 'translate.translate_to en-us'
    expect(screen.getByText(expectedLabel)).toBeVisible()
    const label = screen.getByRole('dialog').textContent
    expect(label).not.toContain('undefined')
    MockUsePreferenceUtils.setPreferenceValue('feature.translate.page.target_language', 'ja-jp')
    view.rerender(contentView())
    expect(screen.getByRole('dialog').textContent).toBe(label)
    await act(async () => request.resolve('Translated selection'))
    expect(screen.getByRole('dialog').textContent).toContain(label.split('translate.processing')[0])
  })

  // Regression: hiding Translate must preserve copy, quote and save instead of hiding or disabling the toolbar.
  it('hides only Translate when disabled', async () => {
    const user = userEvent.setup()
    const view = renderContent()
    MockUsePreferenceUtils.setPreferenceValue('feature.translate.selection_toolbar.enabled', false)
    view.rerender(contentView())
    const content = screen.getByText('Selected message text')
    await selectText(content)
    expect(screen.queryByRole('button', { name: 'translate.button.translate' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'notes.save' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'common.copy' }))
    expect(await navigator.clipboard.readText()).toBe('Selected message text')
    await selectText(content)
    await user.click(screen.getByRole('button', { name: 'chat.message.quote' }))
    expect(window.api.quoteToMainWindow).toHaveBeenCalledWith('Selected message text')
  })

  // RED: raw provider/IPC errors leak keys or arbitrary messages; localized empty errors must keep their category.
  it.each([
    ['translate.error.not_configured', 'Translation model is not configured'],
    ['boom', 'Translation failed'],
    ['The translation result is empty content', 'The translation result is empty content']
  ])('maps %s to a safe localized error', async (message, expected) => {
    const user = userEvent.setup()
    vi.mocked(translateText).mockRejectedValueOnce(new Error(message))
    renderContent()
    await selectText(screen.getByText('Selected message text'))
    await user.click(screen.getByRole('button', { name: 'translate.button.translate' }))
    expect(await screen.findByText(expected)).toBeVisible()
    expect(screen.getByRole('dialog')).not.toHaveTextContent('translate.error.')
    expect(screen.getByRole('dialog')).not.toHaveTextContent('boom')
    expect(screen.getByRole('button', { name: 'common.copy' })).toBeDisabled()
  })

  // RED: wiring card copy to onCopy copies the source instead of the completed translation.
  it('copies the completed translation', async () => {
    const user = userEvent.setup()
    renderContent()
    await selectText(screen.getByText('Selected message text'))
    await user.click(screen.getByRole('button', { name: 'translate.button.translate' }))
    await screen.findByText('Translated selection')
    await user.click(screen.getByRole('button', { name: 'common.copy' }))
    expect(await navigator.clipboard.readText()).toBe('Translated selection')
    expect(screen.getByRole('dialog')).toBeVisible()
  })

  // RED: a capture-phase document scroll handler dismisses the result when its own viewport scrolls.
  it('keeps internal scrolling open and dismisses on external scrolling', async () => {
    const user = userEvent.setup()
    renderContent()
    await selectText(screen.getByText('Selected message text'))
    await user.click(screen.getByRole('button', { name: 'translate.button.translate' }))
    const result = await screen.findByText('Translated selection')
    fireEvent.scroll(result)
    expect(screen.getByRole('dialog')).toBeVisible()
    fireEvent(document, new Event('selectionchange'))
    expect(screen.getByText('Translated selection')).toBeVisible()
    fireEvent.scroll(screen.getByText('Outside content'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  // RED: comparing only text misses identical words at different offsets; resetting on every event loses results.
  it.each([
    ['Selected message text', 0, 8, 9, 16],
    ['Same Same', 0, 4, 5, 9]
  ] as const)(
    'preserves identical selection events but resets changed boundaries in %s',
    async (text, start, end, nextStart, nextEnd) => {
      const user = userEvent.setup()
      renderContent()
      const content = screen.getByText(text)
      await selectText(content, content, () => {
        const range = window.getSelection()!.getRangeAt(0)
        range.setStart(content.firstChild!, start)
        range.setEnd(content.firstChild!, end)
      })
      await user.click(screen.getByRole('button', { name: 'translate.button.translate' }))
      await screen.findByText('Translated selection')
      fireEvent(document, new Event('selectionchange'))
      expect(screen.getByText('Translated selection')).toBeVisible()
      const range = window.getSelection()!.getRangeAt(0)
      range.setEnd(content.firstChild!, nextEnd)
      range.setStart(content.firstChild!, nextStart)
      fireEvent(document, new Event('selectionchange'))
      expect(screen.queryByText('Translated selection')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'translate.button.translate' })).toBeEnabled()
    }
  )

  // RED: closing without invalidating and cancelling allows late streams/results to restore dismissed content.
  it.each(['streaming', 'close button', 'settled hook'] as const)(
    'discards late chunks and completion after dismissal (%s)',
    async (timing) => {
      const user = userEvent.setup()
      const request = pendingTranslation()
      renderContent()
      const content = screen.getByText('Selected message text')
      await selectText(content)
      await user.click(screen.getByRole('button', { name: 'translate.button.translate' }))
      if (timing === 'settled hook') {
        await act(async () => {
          request.resolve('Late result')
          await Promise.resolve()
          fireEvent.keyDown(document, { key: 'Escape' })
        })
      } else {
        if (timing === 'close button') await user.click(screen.getByRole('button', { name: 'common.close' }))
        else fireEvent.keyDown(document, { key: 'Escape' })
        expect(request.signal().aborted).toBe(true)
      }
      act(() => request.respond('Late chunk'))
      await act(async () => request.resolve('Late result'))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      await selectText(content)
      expect(screen.getByRole('button', { name: 'translate.button.translate' })).toBeVisible()
      expect(screen.queryByText(/Late (chunk|result)/)).not.toBeInTheDocument()
    }
  )

  // RED: Back and disabling must abort a pending request without losing the original action selection.
  it.each(['back', 'disable'] as const)('cancels loading on %s and restores the action row', async (action) => {
    const user = userEvent.setup()
    const request = pendingTranslation()
    const view = renderContent()
    await selectText(screen.getByText('Selected message text'))
    await user.click(screen.getByRole('button', { name: 'translate.button.translate' }))
    if (action === 'back') await user.click(screen.getByRole('button', { name: 'common.back' }))
    else {
      MockUsePreferenceUtils.setPreferenceValue('feature.translate.selection_toolbar.enabled', false)
      view.rerender(contentView())
    }
    expect(request.signal().aborted).toBe(true)
    expect(screen.getByRole('button', { name: 'common.copy' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'chat.message.quote' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'notes.save' })).toBeEnabled()
    await act(async () => request.reject(new Error('boom')))
    expect(screen.queryByText('Translation failed')).not.toBeInTheDocument()
  })
  // RED: a new selection must abort the previous request, including late chunks after a replacement starts.
  it('cancels a changed selection before starting a replacement translation', async () => {
    const user = userEvent.setup()
    const first = pendingTranslation()
    const view = renderContent()
    const content = screen.getByText('Selected message text')
    await selectText(content)
    await user.click(screen.getByRole('button', { name: 'translate.button.translate' }))
    const range = window.getSelection()!.getRangeAt(0)
    range.setEnd(content.firstChild!, 8)
    fireEvent(document, new Event('selectionchange'))
    expect(first.signal().aborted).toBe(true)
    const second = pendingTranslation()
    await user.click(screen.getByRole('button', { name: 'translate.button.translate' }))
    act(() => first.respond('Obsolete chunk'))
    await act(async () => first.resolve('Obsolete result'))
    expect(screen.getByText('translate.processing')).toBeVisible()
    await act(async () => second.resolve('Current result'))
    expect(screen.getByText('Current result')).toBeVisible()
    expect(screen.queryByText(/Obsolete/)).not.toBeInTheDocument()
    view.unmount()
  })
})
