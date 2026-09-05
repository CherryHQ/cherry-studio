import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Editor, JSONContent } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import { useEffect } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { COMPOSER_INPUT_MAX_LENGTH, createComposerDraftContent, serializeComposerDocument } from '../composerDraft'
import { createComposerEditorPreset } from '../composerPreset'
import { formatQuoteTokenPromptText } from '../quoteToken'
import type { ComposerSerializedDraft, ComposerSerializedToken } from '../tokens'
import { ComposerToken } from '../tokenView'

vi.unmock('@cherrystudio/ui')

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: vi.fn(() => document.querySelector('[data-composer-token-kind="quote"]'))
  })
})

function createQuoteDraft(content: string, prefix = '', payload?: unknown): ComposerSerializedDraft {
  const promptText = formatQuoteTokenPromptText(content)
  const quoteToken: ComposerSerializedToken = {
    id: 'quote:editable',
    kind: 'quote',
    label: 'Quote',
    description: content,
    promptText,
    ...(payload !== undefined && { payload }),
    index: 0,
    textOffset: prefix.length
  }

  return {
    text: `${prefix}${promptText}`,
    tokens: [quoteToken]
  }
}

function ComposerEditorHarness({
  draft,
  content,
  onEditor
}: {
  draft?: ComposerSerializedDraft
  content?: JSONContent
  onEditor: (editor: Editor) => void
}) {
  const editor = useEditor({
    extensions: createComposerEditorPreset(),
    content: content ?? createComposerDraftContent(draft ?? { text: '', tokens: [] })
  })

  useEffect(() => {
    if (editor) onEditor(editor)
  }, [editor, onEditor])

  return <EditorContent editor={editor} />
}

describe('quote token editing', () => {
  it('edits the complete quote and updates its serialized prompt atomically', async () => {
    const user = userEvent.setup()
    const payload = { sourceMessageId: 'message-1' }
    let editor: Editor | null = null
    render(
      <ComposerEditorHarness
        draft={createQuoteDraft('First line\nSecond line', '', payload)}
        onEditor={(nextEditor) => (editor = nextEditor)}
      />
    )

    await user.click(await screen.findByRole('button', { name: 'common.edit Quote' }))
    const input = await screen.findByRole('textbox', { name: 'Quote' })
    expect(input).toHaveValue('First line\nSecond line')

    await user.clear(input)
    await user.type(input, 'Updated first line{Enter}Updated second line')
    await user.click(screen.getByRole('button', { name: 'common.save' }))

    await waitFor(() => {
      const serialized = serializeComposerDocument(editor!)
      expect(serialized.text).toBe('<blockquote>\n\nUpdated first line\nUpdated second line\n</blockquote>')
      expect(serialized.tokens).toEqual([
        expect.objectContaining({
          id: 'quote:editable',
          description: 'Updated first line\nUpdated second line',
          promptText: '<blockquote>\n\nUpdated first line\nUpdated second line\n</blockquote>',
          payload
        })
      ])
    })

    await user.click(screen.getByRole('button', { name: 'common.edit Quote' }))
    expect(await screen.findByRole('textbox', { name: 'Quote' })).toHaveValue('Updated first line\nUpdated second line')
  })

  it('opens from the keyboard and discards both cancelled and escaped drafts', async () => {
    const user = userEvent.setup()
    const originalDraft = createQuoteDraft('Keep this quote')
    let editor: Editor | null = null
    render(<ComposerEditorHarness draft={originalDraft} onEditor={(nextEditor) => (editor = nextEditor)} />)

    const editButton = await screen.findByRole('button', { name: 'common.edit Quote' })
    act(() => editButton.focus())
    await user.keyboard('{Enter}')
    let input = await screen.findByRole('textbox', { name: 'Quote' })
    await user.clear(input)
    await user.type(input, 'Discard with cancel')
    await user.click(screen.getByRole('button', { name: 'common.cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(serializeComposerDocument(editor!).text).toBe(originalDraft.text)

    act(() => editButton.focus())
    await user.keyboard(' ')
    input = await screen.findByRole('textbox', { name: 'Quote' })
    await user.clear(input)
    await user.type(input, 'Discard with escape')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(serializeComposerDocument(editor!).text).toBe(originalDraft.text)
  })

  it('limits edited quote content to the remaining composer capacity and rejects blank content', async () => {
    const user = userEvent.setup()
    const allowedQuoteCharacters = 5
    const wrapperLength = formatQuoteTokenPromptText('').length
    const prefix = 'x'.repeat(COMPOSER_INPUT_MAX_LENGTH - wrapperLength - allowedQuoteCharacters)
    let editor: Editor | null = null
    render(
      <ComposerEditorHarness draft={createQuoteDraft('old', prefix)} onEditor={(nextEditor) => (editor = nextEditor)} />
    )

    await user.click(await screen.findByRole('button', { name: 'common.edit Quote' }))
    const input = await screen.findByRole('textbox', { name: 'Quote' })
    const saveButton = screen.getByRole('button', { name: 'common.save' })
    await user.clear(input)
    expect(saveButton).toBeDisabled()

    await user.type(input, '123456')
    expect(input).toHaveValue('12345')
    expect(saveButton).toBeEnabled()
    await user.click(saveButton)

    await waitFor(() => {
      const serialized = serializeComposerDocument(editor!)
      expect(serialized.text).toHaveLength(COMPOSER_INPUT_MAX_LENGTH)
      expect(serialized.tokens[0]).toEqual(expect.objectContaining({ description: '12345' }))
    })
  })

  it('counts top-level block separators and a restored CRLF suffix at the exact composer boundary', async () => {
    const user = userEvent.setup()
    const allowedQuoteCharacters = 5
    const wrapperLength = formatQuoteTokenPromptText('').length
    const prefixLength = COMPOSER_INPUT_MAX_LENGTH - wrapperLength - allowedQuoteCharacters - 3
    const firstParagraph = 'x'
    const secondParagraph = 'x'.repeat(prefixLength - firstParagraph.length)
    const content: JSONContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: firstParagraph }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: secondParagraph },
            {
              type: 'composerToken',
              attrs: {
                id: 'quote:boundary',
                kind: 'quote',
                label: 'Quote',
                description: 'old',
                promptText: formatQuoteTokenPromptText('old'),
                payload: { restoredTextSuffix: '\r\n', sourceMessageId: 'message-boundary' }
              }
            }
          ]
        }
      ]
    }
    let editor: Editor | null = null
    render(<ComposerEditorHarness content={content} onEditor={(nextEditor) => (editor = nextEditor)} />)

    await user.click(await screen.findByRole('button', { name: 'common.edit Quote' }))
    const input = await screen.findByRole('textbox', { name: 'Quote' })
    await user.clear(input)
    await user.type(input, '123456')
    expect(input).toHaveValue('12345')
    await user.click(screen.getByRole('button', { name: 'common.save' }))

    await waitFor(() => {
      const serialized = serializeComposerDocument(editor!)
      expect(serialized.text).toHaveLength(COMPOSER_INPUT_MAX_LENGTH)
      expect(serialized.text).toBe(`${firstParagraph}\n${secondParagraph}${formatQuoteTokenPromptText('12345')}\r\n`)
      expect(serialized.tokens[0]).toEqual(
        expect.objectContaining({
          id: 'quote:boundary',
          description: '12345',
          payload: { restoredTextSuffix: '\r\n', sourceMessageId: 'message-boundary' }
        })
      )
    })
  })

  it('keeps sent quotes read-only and does not open the editor from the remove action', async () => {
    const user = userEvent.setup()
    let editor: Editor | null = null
    const { rerender } = render(
      <ComposerEditorHarness draft={createQuoteDraft('Remove me')} onEditor={(nextEditor) => (editor = nextEditor)} />
    )

    const editButton = await screen.findByRole('button', { name: 'common.edit Quote' })
    const removeButton = screen.getByRole('button', { name: 'common.delete' })
    expect(editButton.tagName).toBe('BUTTON')
    expect(removeButton.tagName).toBe('BUTTON')
    expect(editButton.parentElement).toBe(removeButton.parentElement)
    expect(editButton).not.toContainElement(removeButton)

    act(() => editButton.focus())
    expect(editButton).toHaveFocus()
    await user.keyboard('{Enter}')
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: 'common.cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    act(() => removeButton.focus())
    expect(removeButton).toHaveFocus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(serializeComposerDocument(editor!).tokens).toEqual([]))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    rerender(
      <ComposerToken readOnly token={{ id: 'quote:sent', kind: 'quote', label: 'Quote', description: 'Sent quote' }} />
    )
    expect(screen.queryByRole('button', { name: 'common.edit Quote' })).not.toBeInTheDocument()
    expect(screen.getByText('Quote')).toBeInTheDocument()
  })
})
