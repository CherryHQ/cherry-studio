import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type RefObject, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { RichEditorRef } from '@renderer/components/RichEditor/types'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal())

vi.mock('@renderer/data/hooks/usePreference', () => ({
  usePreference: () => [false, vi.fn()]
}))

vi.mock('@renderer/hooks/useCodeStyle', () => ({
  useCodeStyle: () => ({ activeCmTheme: 'light', activeCodeTheme: 'one-light' }),
  useCmTheme: () => 'light'
}))

vi.mock('@renderer/hooks/useNotesSettings', () => ({
  useNotesSettings: () => ({
    settings: {
      defaultViewMode: 'edit',
      defaultEditMode: 'preview'
    }
  })
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key })
}))

import { getCommand } from '@renderer/components/RichEditor/command'

import NotesEditor from '../NotesEditor'

Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () => new DOMRect()
Object.defineProperty(CSS, 'highlights', {
  configurable: true,
  value: new Map()
})

describe('NotesEditor RichEditor integration', () => {
  it('keeps command filtering local while preserving toolbar transactions', async () => {
    const editorRef: RefObject<RichEditorRef | null> = { current: null }
    const initialContent = '12345678901234567890'
    const TestEditor = () => {
      const [content, setContent] = useState(initialContent)

      return (
        <NotesEditor
          hasNotes={true}
          activeNodeId="/notes/example.md"
          currentContent={content}
          tokenCount={content.length}
          editorRef={editorRef}
          codeEditorRef={{ current: null }}
          onMarkdownChange={setContent}
        />
      )
    }
    const { container } = render(<TestEditor />)

    // NotesEditor lazy-loads RichEditor; the real module is heavy enough to exceed the 1s default.
    await waitFor(() => expect(editorRef.current).not.toBeNull(), { timeout: 10_000 })
    expect(screen.getByText('notes.characters: 20')).toBeInTheDocument()
    expect(screen.queryByTestId('toolbar-image')).not.toBeInTheDocument()
    expect(screen.queryByTestId('toolbar-inlineMath')).not.toBeInTheDocument()
    expect(screen.getByTestId('toolbar-blockMath')).toBeInTheDocument()
    expect(getCommand('image')).toBeDefined()
    expect(getCommand('inlineMath')).toBeDefined()

    const contentEditable = container.querySelector<HTMLElement>('[contenteditable="true"]')
    expect(contentEditable).not.toBeNull()
    fireEvent.focus(contentEditable!)

    act(() => editorRef.current?.insertText('x'))
    await waitFor(() => expect(screen.getByText('notes.characters: 21')).toBeInTheDocument())

    const undoButton = screen.getByTestId('toolbar-undo')
    await waitFor(() => expect(undoButton).toBeEnabled())
    fireEvent.blur(contentEditable!)
    fireEvent.click(undoButton)
    await waitFor(() => expect(screen.getByText('notes.characters: 20')).toBeInTheDocument())

    const redoButton = screen.getByTestId('toolbar-redo')
    await waitFor(() => expect(redoButton).toBeEnabled())
    fireEvent.click(redoButton)
    await waitFor(() => expect(screen.getByText('notes.characters: 21')).toBeInTheDocument())

    await waitFor(() => expect(undoButton).toBeEnabled())
    fireEvent.click(undoButton)
    await waitFor(() => expect(screen.getByText('notes.characters: 20')).toBeInTheDocument())
  })

  it('renders loaded bracket math in preview and read without rewriting, and preserves it on text edits', async () => {
    const user = userEvent.setup()
    const editorRef: RefObject<RichEditorRef | null> = { current: null }
    const initialContent = String.raw`before \[ a^2+b^2=c^2 \] after`
    let externalContent = initialContent
    const TestEditor = () => {
      const [content, setContent] = useState(initialContent)
      return (
        <NotesEditor
          hasNotes={true}
          activeNodeId="/notes/math.md"
          currentContent={content}
          tokenCount={content.length}
          editorRef={editorRef}
          codeEditorRef={{ current: null }}
          onMarkdownChange={(next) => {
            externalContent = next
            setContent(next)
          }}
        />
      )
    }
    const { container } = render(<TestEditor />)
    // KaTeX output and its error markers are the rendering contract for loaded formulas.
    const expectFormula = async () => {
      await waitFor(() => expect(container.querySelector('.katex')).not.toBeNull(), { timeout: 10_000 })
      expect(container.querySelector('.katex-error, .inline-math-error, .block-math-error')).toBeNull()
      expect(externalContent).toBe(initialContent)
    }
    await expectFormula()
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: 'notes.settings.editor.view_mode.read_mode' }))
    await expectFormula()
    expect(container.querySelector('[contenteditable="true"]')).toBeNull()
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: 'notes.settings.editor.edit_mode.preview_mode' }))
    await expectFormula()
    act(() => {
      editorRef.current?.focus()
      editorRef.current?.replaceRange({ from: 1, to: 8 }, 'edited ')
    })
    await waitFor(() => expect(externalContent).toBe(String.raw`edited \[ a^2+b^2=c^2 \] after`))
  })
})
