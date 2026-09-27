import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import type { MutableRefObject } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { VoiceTargetManager } from '@renderer/services/voice/VoiceTargetManager'

const mocks = vi.hoisted(() => ({
  selection: { from: 1, to: 4, text: 'selected text' },
  richText: 'unsaved rich draft',
  sourceText: 'unsaved source draft',
  read: vi.fn<
    (input: { text: string; mode: string; sourceEntityId: string; isCurrent: () => boolean }) => Promise<void>
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
  default: ({ ref }: { ref: MutableRefObject<unknown> | ((value: unknown) => void) }) => {
    const value = {
      getSelection: () => mocks.selection,
      getMarkdown: () => mocks.richText,
      focus: () => undefined
    }
    if (typeof ref === 'function') ref(value)
    else ref.current = value
    return <div role="textbox" aria-label="rich draft" tabIndex={0} />
  }
}))
vi.mock('@cherrystudio/ui/components/composites/code-editor', () => ({
  default: ({ ref }: { ref: MutableRefObject<unknown> | ((value: unknown) => void) }) => {
    const value = {
      getSelection: () => mocks.selection,
      getContent: () => mocks.sourceText,
      focus: () => undefined
    }
    if (typeof ref === 'function') ref(value)
    else ref.current = value
    return <div role="textbox" aria-label="source draft" tabIndex={0} />
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
  ])(
    'reads the selection or current draft in $mode mode without offering dictation',
    async ({ mode, editor, draft }) => {
      render(<NotesEditor {...props} />)
      const user = userEvent.setup()
      await screen.findByRole('textbox', { name: 'rich draft' })
      await user.selectOptions(screen.getByRole('combobox', { name: 'view mode' }), mode)
      fireEvent.focus(await screen.findByRole('textbox', { name: editor }))

      expect(screen.queryByRole('button', { name: 'Dictate locally' })).not.toBeInTheDocument()
      expect(mocks.targetManager!.captureCurrent()).toBeNull()
      await user.click(screen.getByRole('button', { name: 'Read aloud' }))
      expect(mocks.read).toHaveBeenLastCalledWith(
        expect.objectContaining({ text: 'selected text', mode: 'selection', sourceEntityId: 'opaque-note-1' })
      )

      mocks.selection = { from: 4, to: 4, text: '' }
      await user.click(screen.getByRole('button', { name: 'Read aloud' }))
      expect(mocks.read).toHaveBeenLastCalledWith(expect.objectContaining({ text: draft, mode: 'document' }))
    }
  )

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

  it('does not offer to insert a recovered transcript into the note', async () => {
    mocks.snapshot = { phase: 'recovery', elapsedMs: 0 }
    render(<NotesEditor {...props} />)
    fireEvent.focus(await screen.findByRole('textbox', { name: 'rich draft' }))
    expect(screen.queryByRole('button', { name: 'Insert transcript' })).not.toBeInTheDocument()
    expect(mocks.targetManager!.captureCurrent()).toBeNull()
    expect(screen.getByRole('button', { name: 'Read aloud' })).toBeEnabled()
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
