import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode, Ref } from 'react'
import { useImperativeHandle, useRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  codeEditorLoaded: vi.fn(),
  codeEditorRefAttached: vi.fn(),
  richEditorLoaded: vi.fn(),
  richEditorRefAttached: vi.fn(),
  settings: {
    defaultViewMode: 'edit',
    defaultEditMode: 'preview',
    fontFamily: 'default',
    fontSize: 16,
    isFullWidth: true,
    showTableOfContents: false
  }
}))

vi.mock('@cherrystudio/ui', () => ({
  EmptyState: () => null,
  SpaceBetweenRowFlex: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Tooltip: ({ children }: { children: ReactNode }) => children
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: () => [true, vi.fn()]
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ error: vi.fn() })
  }
}))

vi.mock('@renderer/components/ActionIconButton', () => ({ default: () => null }))

vi.mock('@renderer/components/CodeEditor', () => {
  mocks.codeEditorLoaded()
  return {
    CodeEditor: function MockCodeEditor({
      ref,
      onChange
    }: {
      ref?: Ref<{ getContent: () => string; scrollToLine: () => void }>
      onChange: (value: string) => void
    }) {
      useImperativeHandle(ref, () => {
        mocks.codeEditorRefAttached()
        return { getContent: () => 'source content', scrollToLine: vi.fn() }
      })
      return (
        <button type="button" onClick={() => onChange('source change')}>
          code editor
        </button>
      )
    }
  }
})

vi.mock('@renderer/components/RichEditor/RichEditor', () => {
  mocks.richEditorLoaded()
  return {
    default: function MockRichEditor({
      ref,
      onMarkdownChange
    }: {
      ref?: Ref<{ getMarkdown: () => string }>
      onMarkdownChange?: (value: string) => void
    }) {
      useImperativeHandle(ref, () => {
        mocks.richEditorRefAttached()
        return { getMarkdown: () => 'rich content' }
      })
      return (
        <button type="button" onClick={() => onMarkdownChange?.('rich change')}>
          rich editor
        </button>
      )
    }
  }
})

vi.mock('@renderer/components/Selector', () => ({
  default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <select aria-label="view mode" value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="preview">Preview</option>
      <option value="source">Source</option>
      <option value="read">Read</option>
    </select>
  )
}))

vi.mock('@renderer/hooks/useCodeStyle', () => ({
  useCodeStyle: () => ({ activeCmTheme: 'light' })
}))

vi.mock('@renderer/hooks/useNotesSettings', () => ({
  useNotesSettings: () => ({ settings: mocks.settings })
}))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))
vi.mock('@renderer/services/toast', () => ({ toast: { error: vi.fn() } }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

import type { CodeEditorHandles } from '@renderer/components/CodeEditor'
import type { RichEditorRef } from '@renderer/components/RichEditor/types'

import NotesEditor from '../NotesEditor'

describe('NotesEditor lazy editor loading', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.settings.defaultViewMode = 'edit'
    mocks.settings.defaultEditMode = 'preview'
  })

  it('loads only the active editor stack and preserves refs and callbacks when switching modes', async () => {
    const onMarkdownChange = vi.fn()

    function TestHarness() {
      const editorRef = useRef<RichEditorRef | null>(null)
      const codeEditorRef = useRef<CodeEditorHandles | null>(null)

      return (
        <NotesEditor
          activeNodeId="note.md"
          currentContent="content"
          tokenCount={7}
          editorRef={editorRef}
          codeEditorRef={codeEditorRef}
          onMarkdownChange={onMarkdownChange}
        />
      )
    }

    render(<TestHarness />)

    await screen.findByRole('button', { name: 'rich editor' })
    expect(mocks.richEditorLoaded).toHaveBeenCalledOnce()
    expect(mocks.codeEditorLoaded).not.toHaveBeenCalled()
    expect(mocks.richEditorRefAttached).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'rich editor' }))
    expect(onMarkdownChange).toHaveBeenCalledWith('rich change')

    fireEvent.change(screen.getByRole('combobox', { name: 'view mode' }), { target: { value: 'source' } })

    await screen.findByRole('button', { name: 'code editor' })
    await waitFor(() => expect(mocks.codeEditorLoaded).toHaveBeenCalledOnce())
    expect(mocks.codeEditorRefAttached).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'code editor' }))
    expect(onMarkdownChange).toHaveBeenCalledWith('source change')
  })
})
