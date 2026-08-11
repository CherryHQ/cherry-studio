import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  richEditorProps: vi.fn(),
  settings: {
    defaultViewMode: 'edit',
    defaultEditMode: 'preview',
    isFullWidth: true,
    showTableOfContents: false,
    fontFamily: 'default',
    fontSize: 16
  }
}))

vi.mock('@renderer/components/RichEditor/RichEditor', () => ({
  default: (props: Record<string, unknown>) => {
    mocks.richEditorProps(props)
    return <div data-testid="rich-editor" />
  }
}))

vi.mock('@renderer/components/CodeEditor', () => ({
  CodeEditor: () => <div data-testid="code-editor" />
}))

vi.mock('@renderer/components/ActionIconButton', () => ({
  default: () => null
}))

vi.mock('@renderer/components/Selector', () => ({
  default: () => null
}))

vi.mock('@renderer/hooks/useCodeStyle', () => ({
  useCodeStyle: () => ({ activeCmTheme: 'light' })
}))

vi.mock('@renderer/hooks/useNotesSettings', () => ({
  useNotesSettings: () => ({ settings: mocks.settings })
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key })
}))

import NotesEditor from '../NotesEditor'

describe('NotesEditor focus behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    ['an existing note', 'first line\n\nlast line with /', false],
    ['a new empty note', '', true],
    ['a whitespace-only note', '  \n\t', true]
  ])('sets auto focus for %s', (_label, currentContent, autoFocus) => {
    render(
      <NotesEditor
        activeNodeId="/notes/example.md"
        currentContent={currentContent}
        tokenCount={currentContent.length}
        editorRef={{ current: null }}
        codeEditorRef={{ current: null }}
        onMarkdownChange={vi.fn()}
      />
    )

    expect(mocks.richEditorProps).toHaveBeenCalledWith(expect.objectContaining({ autoFocus }))
  })

  it('uses instance-level command configuration', () => {
    render(
      <NotesEditor
        activeNodeId="/notes/example.md"
        currentContent="note"
        tokenCount={4}
        editorRef={{ current: null }}
        codeEditorRef={{ current: null }}
        onMarkdownChange={vi.fn()}
      />
    )

    expect(mocks.richEditorProps).toHaveBeenCalledWith(
      expect.objectContaining({ disabledCommands: ['image', 'inlineMath'] })
    )
    expect(mocks.richEditorProps.mock.lastCall?.[0]).not.toHaveProperty('onCommandsReady')
    // Hiding the image command must not disable image paste, which notes have always supported.
    expect(mocks.richEditorProps.mock.lastCall?.[0]).not.toHaveProperty('enableImageInsertion')
  })
})
