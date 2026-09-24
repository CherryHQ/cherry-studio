import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { MutableRefObject } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { VoiceTargetManager } from '@renderer/services/voice/VoiceTargetManager'

const mocks = vi.hoisted(() => ({
  selection: { from: 1, to: 4, text: 'old' },
  richText: 'unsaved rich draft',
  sourceText: 'unsaved source draft',
  richReady: true,
  replaceRich: vi.fn(() => true),
  replaceSource: vi.fn(() => true),
  read: vi.fn(async () => undefined),
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
  dictationService: { subscribe: () => () => undefined, getSnapshot: () => mocks.snapshot }
}))
vi.mock('@renderer/components/RichEditor/RichEditor', () => ({
  default: ({ ref }: { ref: MutableRefObject<unknown> | ((value: unknown) => void) }) => {
    const value = mocks.richReady
      ? {
          getSelection: () => mocks.selection,
          replaceRange: mocks.replaceRich,
          getMarkdown: () => mocks.richText,
          focus: () => undefined
        }
      : null
    if (typeof ref === 'function') ref(value)
    else ref.current = value
    return <div role="textbox" aria-label="rich draft" tabIndex={0} />
  }
}))
vi.mock('@cherrystudio/ui/components/composites/code-editor', () => ({
  default: ({ ref }: { ref: MutableRefObject<unknown> | ((value: unknown) => void) }) => {
    const value = {
      getSelection: () => mocks.selection,
      replaceRange: mocks.replaceSource,
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
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key })
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

describe('Notes voice integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.targetManager = new VoiceTargetManager()
    editorRef.current = null
    codeEditorRef.current = null
    mocks.selection = { from: 1, to: 4, text: 'old' }
    mocks.richReady = true
    mocks.richText = 'unsaved rich draft'
    mocks.log.mockClear()
    mocks.snapshot = { phase: 'idle', elapsedMs: 0 }
  })

  it('replaces the live rich selection and reads that selection before the unsaved draft', async () => {
    render(<NotesEditor {...props} />)
    fireEvent.focus(await screen.findByRole('textbox', { name: 'rich draft' }))
    const binding = mocks.targetManager!.captureCurrent()
    expect(binding?.sourceEntityId).toBe('opaque-note-1')
    expect(binding?.targetId).not.toContain('/private')

    mocks.selection = { from: 5, to: 8, text: 'new' }
    expect(mocks.targetManager!.insert(binding!, 'spoken')).toBe('inserted')
    expect(mocks.replaceRich).toHaveBeenCalledWith({ from: 5, to: 8 }, 'spoken')

    fireEvent.click(screen.getByRole('button', { name: 'chat.message.read_aloud.label' }))
    expect(mocks.read).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'new',
        mode: 'selection',
        sourceLabel: 'selection',
        sourceEntityId: 'opaque-note-1'
      })
    )

    mocks.selection = { from: 8, to: 8, text: '' }
    fireEvent.click(screen.getByRole('button', { name: 'chat.message.read_aloud.label' }))
    expect(mocks.read).toHaveBeenLastCalledWith(
      expect.objectContaining({
        text: 'unsaved rich draft',
        mode: 'document',
        sourceLabel: 'document'
      })
    )
  })

  it('invalidates the rich binding on source mode and a note switch', async () => {
    const view = render(<NotesEditor {...props} />)
    fireEvent.focus(await screen.findByRole('textbox', { name: 'rich draft' }))
    const old = mocks.targetManager!.captureCurrent()!
    fireEvent.change(screen.getByRole('combobox', { name: 'view mode' }), { target: { value: 'source' } })
    expect(mocks.targetManager!.insert(old, 'stale')).toBe('unavailable')
    fireEvent.focus(await screen.findByRole('textbox', { name: 'source draft' }))
    const source = mocks.targetManager!.captureCurrent()!
    mocks.selection = { from: 2, to: 6, text: 'live' }
    expect(mocks.targetManager!.insert(source, 'spoken')).toBe('inserted')
    expect(mocks.replaceSource).toHaveBeenCalledWith({ from: 2, to: 6 }, 'spoken')

    view.rerender(<NotesEditor {...props} activeNodeId="/private/other.md" voiceNoteId="opaque-note-2" />)
    await waitFor(() => expect(mocks.targetManager!.insert(source, 'stale')).toBe('unavailable'))
    fireEvent.focus(screen.getByRole('textbox', { name: 'rich draft' }))
    expect(mocks.targetManager!.insertIntoCurrent('recovered', 'user_recovery')).toBe('inserted')
    expect(mocks.replaceRich).toHaveBeenLastCalledWith({ from: 2, to: 6 }, 'recovered')
  })

  it('disables dictation in read mode while preserving manual playback', async () => {
    render(<NotesEditor {...props} />)
    await screen.findByRole('textbox', { name: 'rich draft' })
    fireEvent.change(screen.getByRole('combobox', { name: 'view mode' }), { target: { value: 'read' } })
    expect(screen.getByRole('button', { name: 'chat.input.dictation.title' })).toBeDisabled()
    expect(mocks.targetManager!.captureCurrent()).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'chat.message.read_aloud.label' }))
    expect(mocks.read).toHaveBeenCalledWith(expect.objectContaining({ mode: 'selection' }))
  })

  it('does not insert a recovered transcript while read mode is active', async () => {
    mocks.snapshot = { phase: 'recovery', elapsedMs: 0 }
    render(<NotesEditor {...props} />)
    await screen.findByRole('textbox', { name: 'rich draft' })
    fireEvent.change(screen.getByRole('combobox', { name: 'view mode' }), { target: { value: 'read' } })
    expect(screen.getByRole('button', { name: 'settings.voice.action.insert_recovery' })).toBeDisabled()
  })

  it('keeps dictation disabled until the lazy editor exposes its selection adapter', async () => {
    mocks.richReady = false
    const view = render(<NotesEditor {...props} />)
    expect(screen.getByRole('button', { name: 'chat.input.dictation.title' })).toBeDisabled()
    mocks.richReady = true
    view.rerender(<NotesEditor {...props} currentContent="new draft" />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'chat.input.dictation.title' })).toBeEnabled())
  })

  it('keeps note text, selection, and physical path out of public metadata and ambient sinks', async () => {
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem')
    const pushState = vi.spyOn(window.history, 'pushState')
    const replaceState = vi.spyOn(window.history, 'replaceState')
    const secrets = ['PRIVATE_NOTE_DRAFT_91', 'PRIVATE_NOTE_SELECTION_82', '/PRIVATE_NOTE_PATH_73/']
    mocks.richText = secrets[0]
    mocks.selection = { from: 1, to: 4, text: secrets[1] }

    const view = render(<NotesEditor {...props} activeNodeId={`${secrets[2]}note.md`} />)
    fireEvent.focus(await screen.findByRole('textbox', { name: 'rich draft' }))
    const binding = mocks.targetManager!.captureCurrent()!
    fireEvent.click(screen.getByRole('button', { name: 'chat.message.read_aloud.label' }))

    const metadata = JSON.stringify({ targetId: binding.targetId, sourceEntityId: binding.sourceEntityId })
    const ambientWrites = JSON.stringify([
      mocks.log.mock.calls,
      storageWrite.mock.calls,
      pushState.mock.calls,
      replaceState.mock.calls
    ])
    for (const secret of secrets) {
      expect(metadata).not.toContain(secret)
      expect(ambientWrites).not.toContain(secret)
    }
    expect(mocks.read).toHaveBeenCalledWith(expect.objectContaining({ text: secrets[1] }))
    view.unmount()
    storageWrite.mockRestore()
    pushState.mockRestore()
    replaceState.mockRestore()
  })
})
