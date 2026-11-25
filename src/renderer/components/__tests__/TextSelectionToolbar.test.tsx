import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CommandProvider } from '@renderer/components/command'
import { ComposerLayerActiveProvider } from '@renderer/components/composer/ComposerContext'
import type { ComposerSerializedDraft } from '@renderer/components/composer/tokens'
import { useComposerQuoteInsertion } from '@renderer/components/composer/variants/shared/composerQuote'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { isMac } from '@renderer/utils/platform'

import SelectionContextMenu from '../SelectionContextMenu'

vi.unmock('@cherrystudio/ui')
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

function TestComposer({
  topicId,
  editing,
  acceptsDraft
}: {
  topicId: string
  editing: boolean
  acceptsDraft: boolean
}) {
  const [draft, setDraft] = useState<ComposerSerializedDraft>({ text: 'Existing draft', tokens: [] })
  const nextActions = {
    getDraft: () => draft,
    replaceDraft: (next: ComposerSerializedDraft) => {
      if (!acceptsDraft) return false
      setDraft(next)
      return true
    },
    focus: () => {},
    insertToken: () => {}
  }
  const actions = useRef(nextActions)
  actions.current = nextActions
  useComposerQuoteInsertion(actions, topicId, !editing)
  return <pre data-testid="composer-draft">{draft.text}</pre>
}

interface SelectionFixtureProps {
  quoteTopicId?: string
  composerActive?: boolean
  editing?: boolean
  acceptsDraft?: boolean
}

function SelectionFixture({
  quoteTopicId,
  composerActive = true,
  editing = false,
  acceptsDraft = true
}: SelectionFixtureProps) {
  return (
    <CommandProvider>
      <SelectionContextMenu quoteTopicId={quoteTopicId}>
        <div>
          <p data-message-id="source-message">Selected message text</p>
          <div contentEditable suppressContentEditableWarning>
            Editable draft
          </div>
        </div>
      </SelectionContextMenu>
      <p>Outside content</p>
      {quoteTopicId && (
        <ComposerLayerActiveProvider value={composerActive}>
          <TestComposer topicId={quoteTopicId} editing={editing} acceptsDraft={acceptsDraft} />
        </ComposerLayerActiveProvider>
      )}
    </CommandProvider>
  )
}

function renderContent(props: SelectionFixtureProps = {}) {
  return render(<SelectionFixture {...props} />)
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
    window.getSelection()?.removeAllRanges()
    MockUsePreferenceUtils.setPreferenceValue('menu.presentation_mode', 'cherry')
    MockUsePreferenceUtils.setPreferenceValue('shortcut.chat.message.quote_selection', {
      binding: ['CommandOrControl', 'Shift', 'Y'],
      enabled: true
    })
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

  it('uses the displayed shortcut to quote the selection with its source', async () => {
    const inserted = EventEmitter.once(EVENT_NAMES.INSERT_COMPOSER_QUOTE)
    renderContent({ quoteTopicId: 'topic-id' })
    const content = screen.getByText('Selected message text')
    const shortcut = { key: 'Y', shiftKey: true, ctrlKey: !isMac, metaKey: isMac }
    expect(fireEvent.keyDown(content, shortcut)).toBe(true)
    await selectText(content)
    expect(await screen.findByRole('button', { name: 'chat.message.quote' })).toHaveTextContent(
      isMac ? '⌘⇧Y' : 'Ctrl+Shift+Y'
    )
    expect(fireEvent.keyDown(content, shortcut)).toBe(false)
    await expect(inserted).resolves.toEqual({
      topicId: 'topic-id',
      text: 'Selected message text',
      sourceMessageId: 'source-message'
    })
  })

  it('uses the remapped Quote shortcut and hides it when disabled', async () => {
    const binding = ['Alt', 'J']
    MockUsePreferenceUtils.setPreferenceValue('shortcut.chat.message.quote_selection', { binding, enabled: true })
    const { unmount } = renderContent()
    const content = screen.getByText('Selected message text')
    await selectText(content)
    expect(await screen.findByRole('button', { name: 'chat.message.quote' })).toHaveTextContent(isMac ? '⌥J' : 'Alt+J')
    expect(fireEvent.keyDown(content, { key: 'Y', shiftKey: true, ctrlKey: !isMac, metaKey: isMac })).toBe(true)
    expect(fireEvent.keyDown(content, { key: 'j', altKey: true })).toBe(false)
    expect(window.api.quoteToMainWindow).toHaveBeenCalledExactlyOnceWith('Selected message text')

    unmount()
    MockUsePreferenceUtils.setPreferenceValue('shortcut.chat.message.quote_selection', { binding, enabled: false })
    renderContent()
    const nextContent = screen.getByText('Selected message text')
    await selectText(nextContent)
    expect(await screen.findByRole('button', { name: 'chat.message.quote' })).toHaveTextContent(
      /^chat\.message\.quote$/
    )
    expect(fireEvent.keyDown(nextContent, { key: 'j', altKey: true })).toBe(true)
    expect(window.api.quoteToMainWindow).toHaveBeenCalledTimes(1)
  })

  it('saves the captured quote and reply to the composer only after clicking Save', async () => {
    const user = userEvent.setup()
    renderContent({ quoteTopicId: 'topic-id' })
    await selectText(screen.getByText('Selected message text'))
    await user.click(await screen.findByRole('button', { name: 'chat.message.reply' }))
    const dialog = within(screen.getByRole('dialog', { name: 'chat.message.reply' }))
    const sourceLink = dialog.getByRole('button', { name: 'chat.input.locate_editing_message' })
    expect(dialog.getByRole('blockquote')).toHaveTextContent('Selected message text')
    expect(dialog.queryByText('chat.message.quote')).not.toBeInTheDocument()
    expect(dialog.queryByText('chat.message.reply')).not.toBeInTheDocument()
    const input = screen.getByRole('textbox', { name: 'chat.message.reply' })
    const saveButton = screen.getByRole('button', { name: 'common.save' })
    expect(input).toHaveFocus()
    expect(saveButton).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'chat.input.send' })).not.toBeInTheDocument()

    const locate = EventEmitter.once(EVENT_NAMES.LOCATE_QUOTED_MESSAGE)
    await user.click(sourceLink)
    await expect(locate).resolves.toBe('source-message')
    window.getSelection()?.removeAllRanges()
    fireEvent(document, new Event('selectionchange'))
    await user.type(input, '    first line{Enter}    second line')

    const composer = screen.getByTestId('composer-draft')
    expect(composer.textContent).toBe('Existing draft')
    await user.click(saveButton)
    expect(composer.textContent).toContain('Existing draft\n\n')
    expect(composer.textContent).toContain('Selected message text')
    expect(composer.textContent).toMatch(/\n    first line\n    second line$/)
    await waitFor(() => expect(input).not.toBeInTheDocument())
  })

  it.each([
    { condition: 'a tool approval takes over', blocked: { composerActive: false } },
    { condition: 'editing a sent message', blocked: { editing: true } }
  ])('keeps a typed reply when $condition', async ({ blocked }) => {
    const user = userEvent.setup()
    const { rerender } = renderContent({ quoteTopicId: 'topic-id' })
    await selectText(screen.getByText('Selected message text'))
    await user.click(await screen.findByRole('button', { name: 'chat.message.reply' }))
    const input = screen.getByRole('textbox', { name: 'chat.message.reply' })
    const save = screen.getByRole('button', { name: 'common.save' })
    const composer = screen.getByTestId('composer-draft')
    await user.type(input, 'Keep this reply')

    rerender(<SelectionFixture quoteTopicId="topic-id" {...blocked} />)
    expect(save).toBeDisabled()
    await user.click(save)
    expect(composer.textContent).toBe('Existing draft')
    expect(input).toHaveValue('Keep this reply')

    rerender(<SelectionFixture quoteTopicId="topic-id" />)
    await user.click(save)
    expect(composer.textContent).toContain('Keep this reply')
  })

  it('keeps a typed reply when the composer rejects the draft, and allows retry', async () => {
    const user = userEvent.setup()
    const { rerender } = renderContent({ quoteTopicId: 'topic-id', acceptsDraft: false })
    await selectText(screen.getByText('Selected message text'))
    await user.click(await screen.findByRole('button', { name: 'chat.message.reply' }))
    const input = screen.getByRole('textbox', { name: 'chat.message.reply' })
    const save = screen.getByRole('button', { name: 'common.save' })
    await user.type(input, 'Retry this reply')
    await user.click(save)
    expect(input).toHaveValue('Retry this reply')
    expect(screen.getByTestId('composer-draft').textContent).toBe('Existing draft')
    rerender(<SelectionFixture quoteTopicId="topic-id" />)
    await user.click(save)
    expect(screen.getByTestId('composer-draft').textContent).toContain('Retry this reply')
  })

  it('discards a reply when Cancel is clicked', async () => {
    const user = userEvent.setup()
    renderContent({ quoteTopicId: 'topic-id' })
    const content = screen.getByText('Selected message text')
    await selectText(content)
    await user.click(await screen.findByRole('button', { name: 'chat.message.reply' }))
    const input = screen.getByRole('textbox', { name: 'chat.message.reply' })
    await user.type(input, 'Discard this')
    await user.click(screen.getByRole('button', { name: 'common.cancel' }))
    expect(screen.getByTestId('composer-draft').textContent).toBe('Existing draft')
    await selectText(content)
    await user.click(await screen.findByRole('button', { name: 'chat.message.reply' }))
    expect(screen.getByRole('textbox', { name: 'chat.message.reply' })).toHaveValue('')
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
})
