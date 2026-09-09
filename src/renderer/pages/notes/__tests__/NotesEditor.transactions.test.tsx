import type { RichEditorRef } from '@renderer/components/RichEditor/types'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { type RefObject, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal())

vi.mock('@renderer/data/hooks/usePreference', () => ({
  usePreference: () => [false, vi.fn()]
}))

vi.mock('@renderer/hooks/useCodeStyle', () => ({
  useCodeStyle: () => ({ activeCmTheme: 'light', activeShikiTheme: 'one-light' }),
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
})
