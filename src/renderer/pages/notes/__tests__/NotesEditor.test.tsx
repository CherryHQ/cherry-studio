import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  codeEditorEvaluations: 0,
  richEditorEvaluations: 0,
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

vi.mock('@renderer/components/RichEditor/RichEditor', () => {
  mocks.richEditorEvaluations += 1
  return {
    default: (props: Record<string, unknown>) => {
      mocks.richEditorProps(props)
      return <div data-testid="rich-editor" />
    }
  }
})

vi.mock('@cherrystudio/ui/components/composites/code-editor', () => {
  mocks.codeEditorEvaluations += 1
  return { default: () => <div data-testid="code-editor" /> }
})

vi.mock('@renderer/components/ActionIconButton', () => ({
  default: ({
    'aria-label': label,
    'aria-pressed': pressed,
    onClick
  }: {
    'aria-label'?: string
    'aria-pressed'?: boolean
    onClick?: () => void
  }) => <button type="button" aria-label={label} aria-pressed={pressed} onClick={onClick} />
}))

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
  useCodeStyle: () => ({ activeCmTheme: 'light' }),
  useCmTheme: () => 'light'
}))

vi.mock('@renderer/hooks/useNotesSettings', () => ({
  useNotesSettings: () => ({ settings: mocks.settings })
}))

import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'

import i18n from '@renderer/i18n/resolver'

import NotesEditor from '../NotesEditor'

let previousLanguage: string

beforeAll(async () => {
  previousLanguage = i18n.language
  await i18n.changeLanguage('en-US')
})

afterAll(async () => {
  await i18n.changeLanguage(previousLanguage)
})

describe('NotesEditor focus behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setPreferenceValue('app.spell_check.enabled', false)
  })

  it('loads only the selected editor stack', async () => {
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

    expect(await screen.findByTestId('rich-editor')).toBeInTheDocument()
    expect(mocks.richEditorEvaluations).toBe(1)
    expect(mocks.codeEditorEvaluations).toBe(0)

    fireEvent.change(screen.getByRole('combobox', { name: 'view mode' }), { target: { value: 'source' } })

    expect(await screen.findByTestId('code-editor')).toBeInTheDocument()
    expect(mocks.codeEditorEvaluations).toBe(1)
  })

  it('marks the active note surface with its node id', async () => {
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

    await screen.findByTestId('rich-editor')
    expect(document.querySelector('[data-ui="notes.editor"]')).toHaveAttribute('data-note-id', '/notes/example.md')
  })

  it('names the spell check toggle in the editor footer', async () => {
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

    await screen.findByTestId('rich-editor')
    expect(screen.getByRole('button', { name: 'Enable/Disable spell check' })).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('NotesEditor empty state', () => {
  const emptyEditorProps = {
    currentContent: '',
    tokenCount: 0,
    editorRef: { current: null },
    codeEditorRef: { current: null },
    onMarkdownChange: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('exposes the canonical create-note action when no note is selected', async () => {
    const user = userEvent.setup()
    const onCreateNote = vi.fn()

    render(<NotesEditor {...emptyEditorProps} onCreateNote={onCreateNote} />)

    expect(screen.getByText('No notes available yet')).toBeInTheDocument()
    const createButton = screen.getByRole('button', { name: 'Create a new note' })
    await user.click(createButton)

    expect(onCreateNote).toHaveBeenCalledTimes(1)
  })

  it('does not expose a create-note action on a load error', () => {
    render(
      <NotesEditor
        activeNodeId="/notes/example.md"
        currentContent=""
        contentLoadError={new Error('read failed')}
        tokenCount={0}
        editorRef={{ current: null }}
        codeEditorRef={{ current: null }}
        onMarkdownChange={vi.fn()}
        onCreateNote={vi.fn()}
      />
    )

    expect(screen.getByText('Failed to load note')).toBeInTheDocument()
  })
})
