import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { type MutableRefObject, useImperativeHandle, useRef } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { VoiceTargetManager } from '@renderer/services/voice/VoiceTargetManager'

vi.unmock('@cherrystudio/ui')

const mocks = vi.hoisted(() => ({
  selection: { from: 1, to: 4, text: 'selected text' },
  richText: 'unsaved rich draft',
  sourceText: 'unsaved source draft',
  read: vi.fn<
    (input: {
      text: string
      mode: string
      sourceEntityId: string
      isCurrent: () => boolean
      focusOnClose: () => void
    }) => Promise<void>
  >(async () => undefined),
  log: vi.fn(),
  snapshot: { phase: 'idle', elapsedMs: 0 },
  targetManager: undefined as VoiceTargetManager | undefined
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ info: mocks.log, debug: mocks.log, warn: mocks.log, error: mocks.log }) }
}))

vi.mock('@renderer/services/voice', () => ({
  get voiceTargetManager() {
    return mocks.targetManager
  },
  readTextAloud: mocks.read,
  dictationService: {
    subscribe: () => () => undefined,
    getSnapshot: () => mocks.snapshot
  }
}))
vi.mock('@renderer/components/RichEditor/RichEditor', () => ({
  default: function MockRichEditor({ ref }: { ref: MutableRefObject<unknown> | ((value: unknown) => void) }) {
    const nodeRef = useRef<HTMLDivElement>(null)
    useImperativeHandle(ref, () => ({
      getSelection: () => mocks.selection,
      getMarkdown: () => mocks.richText,
      focus: () => nodeRef.current?.focus()
    }))
    return <div ref={nodeRef} role="textbox" aria-label="rich draft" tabIndex={0} />
  }
}))
vi.mock('@cherrystudio/ui/components/composites/code-editor', () => ({
  default: function MockSourceEditor({ ref }: { ref: MutableRefObject<unknown> | ((value: unknown) => void) }) {
    const nodeRef = useRef<HTMLDivElement>(null)
    useImperativeHandle(ref, () => ({
      getSelection: () => mocks.selection,
      getContent: () => mocks.sourceText,
      focus: () => nodeRef.current?.focus()
    }))
    return <div ref={nodeRef} role="textbox" aria-label="source draft" tabIndex={0} />
  }
}))
vi.mock('@renderer/components/ActionIconButton', () => ({ default: () => null }))
vi.mock('@renderer/components/Selector', () => ({
  default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <select aria-label="view mode" value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="preview">Preview</option>
      <option value="source">Source</option>
      <option value="read">Read</option>
    </select>
  )
}))
vi.mock('@renderer/hooks/useCodeStyle', () => ({ useCmTheme: () => 'light' }))
vi.mock('@renderer/hooks/useNotesSettings', () => ({
  useNotesSettings: () => ({
    settings: {
      defaultViewMode: 'edit',
      defaultEditMode: 'preview',
      isFullWidth: true,
      showTableOfContents: false,
      fontFamily: 'default',
      fontSize: 16
    }
  })
}))
import NotesEditor from '../NotesEditor'

const editorRef = { current: null }
const codeEditorRef = { current: null }
const props = {
  activeNodeId: '/private/note.md',
  voiceNoteId: 'opaque-note-1',
  currentContent: 'disk content',
  tokenCount: 12,
  editorRef,
  codeEditorRef,
  onMarkdownChange: vi.fn()
}

describe('Notes manual read-aloud', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en-US')
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.targetManager = new VoiceTargetManager()
    editorRef.current = null
    codeEditorRef.current = null
    mocks.selection = { from: 1, to: 4, text: 'selected text' }
    mocks.richText = 'unsaved rich draft'
    mocks.sourceText = 'unsaved source draft'
    mocks.snapshot = { phase: 'idle', elapsedMs: 0 }
  })

  it.each([
    { mode: 'preview', editor: 'rich draft', draft: 'unsaved rich draft' },
    { mode: 'source', editor: 'source draft', draft: 'unsaved source draft' },
    { mode: 'read', editor: 'rich draft', draft: 'unsaved rich draft' }
  ])('reads the selection or current draft in $mode mode', async ({ mode, editor, draft }) => {
    render(<NotesEditor {...props} />)
    const user = userEvent.setup()
    await screen.findByRole('textbox', { name: 'rich draft' })
    await user.selectOptions(screen.getByRole('combobox', { name: 'view mode' }), mode)
    fireEvent.focus(await screen.findByRole('textbox', { name: editor }))

    await user.click(screen.getByRole('button', { name: 'Read aloud' }))
    expect(mocks.read).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: 'selected text', mode: 'selection', sourceEntityId: 'opaque-note-1' })
    )

    mocks.selection = { from: 4, to: 4, text: '' }
    await user.click(screen.getByRole('button', { name: 'Read aloud' }))
    expect(mocks.read).toHaveBeenLastCalledWith(expect.objectContaining({ text: draft, mode: 'document' }))
  })

  it.each([
    { before: 'source', after: 'preview', target: 'rich draft' },
    { before: 'preview', after: 'source', target: 'source draft' },
    { before: 'preview', after: 'read', target: 'Read aloud' }
  ])('restores focus to the current $after mode after a pending $before read', async ({ before, after, target }) => {
    let finish!: () => void
    const pending = new Promise<void>((resolve) => {
      finish = resolve
    })
    mocks.read.mockImplementationOnce(async ({ focusOnClose }) => {
      await pending
      focusOnClose()
    })
    const user = userEvent.setup()
    render(<NotesEditor {...props} />)
    await screen.findByRole('textbox', { name: 'rich draft' })
    await user.selectOptions(screen.getByRole('combobox', { name: 'view mode' }), before)
    await user.click(screen.getByRole('button', { name: 'Read aloud' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'view mode' }), after)
    await screen.findByRole(after === 'read' ? 'button' : 'textbox', { name: target })

    await act(async () => finish())

    expect(screen.getByRole(after === 'read' ? 'button' : 'textbox', { name: target })).toHaveFocus()
  })

  it('restores focus to the read control when the current editor handle is unavailable', async () => {
    const user = userEvent.setup()
    render(<NotesEditor {...props} />)
    await screen.findByRole('textbox', { name: 'rich draft' })
    await user.click(screen.getByRole('button', { name: 'Read aloud' }))
    const request = mocks.read.mock.calls[0][0]
    screen.getByRole('combobox', { name: 'view mode' }).focus()
    editorRef.current = null

    request.focusOnClose()

    expect(screen.getByRole('button', { name: 'Read aloud' })).toHaveFocus()
  })

  it('does not move focus from a new note when the old confirmation closes', async () => {
    const user = userEvent.setup()
    const view = render(<NotesEditor {...props} />)
    await screen.findByRole('textbox', { name: 'rich draft' })
    await user.click(screen.getByRole('button', { name: 'Read aloud' }))
    const request = mocks.read.mock.calls[0][0]
    view.rerender(<NotesEditor {...props} activeNodeId="/private/other.md" voiceNoteId="opaque-note-2" />)
    await screen.findByRole('textbox', { name: 'rich draft' })
    const mode = screen.getByRole('combobox', { name: 'view mode' })
    mode.focus()

    request.focusOnClose()

    expect(mode).toHaveFocus()
  })

  it('invalidates an old read when loading replaces the editor and reuses its parent refs', async () => {
    const user = userEvent.setup()
    const oldEditor = render(<NotesEditor {...props} />)
    await screen.findByRole('textbox', { name: 'rich draft' })
    await user.click(screen.getByRole('button', { name: 'Read aloud' }))
    const request = mocks.read.mock.calls[0][0]
    expect(request.isCurrent()).toBe(true)
    oldEditor.unmount()
    render(<NotesEditor {...props} activeNodeId="/private/other.md" voiceNoteId="opaque-note-2" />)
    await screen.findByRole('textbox', { name: 'rich draft' })
    const mode = screen.getByRole('combobox', { name: 'view mode' })
    mode.focus()

    expect(request.isCurrent()).toBe(false)
    request.focusOnClose()

    expect(mode).toHaveFocus()
  })

  it('invalidates a pending read-aloud confirmation when the selected note changes', async () => {
    const view = render(<NotesEditor {...props} />)
    await screen.findByRole('textbox', { name: 'rich draft' })
    fireEvent.click(screen.getByRole('button', { name: 'Read aloud' }))
    const oldRequest = mocks.read.mock.calls[0][0]
    expect(oldRequest.isCurrent()).toBe(true)

    view.rerender(<NotesEditor {...props} activeNodeId="/private/other.md" voiceNoteId="opaque-note-2" />)
    await waitFor(() => expect(oldRequest.isCurrent()).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Read aloud' }))
    expect(mocks.read).toHaveBeenLastCalledWith(expect.objectContaining({ sourceEntityId: 'opaque-note-2' }))
  })

  it('keeps note text, selection, and physical path out of public metadata and ambient sinks', async () => {
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem')
    const pushState = vi.spyOn(window.history, 'pushState')
    const replaceState = vi.spyOn(window.history, 'replaceState')
    const secrets = ['PRIVATE_NOTE_DRAFT_91', 'PRIVATE_NOTE_SELECTION_82', '/PRIVATE_NOTE_PATH_73/']
    mocks.richText = secrets[0]
    mocks.selection = { from: 1, to: 4, text: secrets[1] }

    const view = render(<NotesEditor {...props} activeNodeId={`${secrets[2]}note.md`} />)
    await screen.findByRole('textbox', { name: 'rich draft' })
    fireEvent.click(screen.getByRole('button', { name: 'Read aloud' }))
    const request = mocks.read.mock.calls[0][0]
    const ambientWrites = JSON.stringify([
      mocks.log.mock.calls,
      storageWrite.mock.calls,
      pushState.mock.calls,
      replaceState.mock.calls
    ])
    for (const secret of secrets) {
      expect(request.sourceEntityId).not.toContain(secret)
      expect(ambientWrites).not.toContain(secret)
    }
    expect(request.text).toBe(secrets[1])
    view.unmount()
    storageWrite.mockRestore()
    pushState.mockRestore()
    replaceState.mockRestore()
  })
})
