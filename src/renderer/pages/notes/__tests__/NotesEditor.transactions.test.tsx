import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { type RefObject, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { RichEditorRef } from '@renderer/components/RichEditor/types'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal())

vi.mock('@renderer/data/hooks/usePreference', () => ({
  usePreference: () => [false, vi.fn()]
}))

vi.mock('@renderer/hooks/useCodeStyle', () => ({
  useCodeStyle: () => ({ activeCmTheme: 'light', activeShikiTheme: 'one-light' })
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

import NotesEditor from '../NotesEditor'

Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () => new DOMRect()
Object.defineProperty(CSS, 'highlights', {
  configurable: true,
  value: new Map()
})

describe('NotesEditor character count transactions', () => {
  it('tracks undo, redo, and repeated undo from the toolbar', async () => {
    const editorRef: RefObject<RichEditorRef | null> = { current: null }
    const initialContent = '12345678901234567890'
    const TestEditor = () => {
      const [content, setContent] = useState(initialContent)

      return (
        <NotesEditor
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

    await waitFor(() => expect(editorRef.current).not.toBeNull())
    expect(screen.getByText('notes.characters: 20')).toBeInTheDocument()

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
})
