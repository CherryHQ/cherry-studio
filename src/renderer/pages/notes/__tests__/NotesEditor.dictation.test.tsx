import { EditorView } from '@codemirror/view'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { useState } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CodeEditorHandles } from '@cherrystudio/ui'
import type { RichEditorRef } from '@renderer/components/RichEditor/types'
import { dictationService, voiceTargetManager } from '@renderer/services/voice'
import type { CapturedVoiceTarget } from '@renderer/services/voice'

vi.unmock('@cherrystudio/ui')
vi.mock('@renderer/hooks/useCodeStyle', () => ({
  useCodeStyle: () => ({ activeCmTheme: 'light', activeShikiTheme: 'one-light' }),
  useCmTheme: () => 'light'
}))

import NotesEditor from '../NotesEditor'

Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () => new DOMRect()

const editorRef: { current: RichEditorRef | null } = { current: null }
const codeEditorRef: { current: CodeEditorHandles | null } = { current: null }

function Note({ id = 'opaque-note-1', initialContent = 'alpha beta' }: { id?: string; initialContent?: string }) {
  const [content, setContent] = useState(initialContent)
  return (
    <>
      <NotesEditor
        activeNodeId={`/private/${id}.md`}
        voiceNoteId={id}
        currentContent={content}
        tokenCount={content.length}
        editorRef={editorRef}
        codeEditorRef={codeEditorRef}
        onMarkdownChange={setContent}
      />
      <output aria-label="saved draft">{content}</output>
    </>
  )
}

async function switchMode(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByRole('combobox'))
  await user.click(await screen.findByRole('option', { name: label }))
}

describe('Notes dictation integration', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en-US')
  })

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(dictationService, 'startScoped').mockReturnValue({
      result: Promise.resolve(),
      cancel: async () => undefined
    })
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.notes.default_view_mode': 'edit',
      'feature.notes.default_edit_mode': 'preview',
      'feature.notes.full_width': true,
      'feature.notes.font_family': 'default',
      'feature.notes.font_size': 16,
      'feature.notes.show_table_of_contents': false,
      'feature.notes.line_breaks': true
    })
    editorRef.current = null
    codeEditorRef.current = null
  })

  it('starts from the microphone and replaces the live rich-text selection in the saved draft', async () => {
    let binding: CapturedVoiceTarget | null = null
    vi.spyOn(dictationService, 'startScoped').mockImplementation(() => {
      binding = voiceTargetManager.captureCurrent()
      return { result: Promise.resolve(), cancel: async () => undefined }
    })
    const user = userEvent.setup()
    render(<Note />)
    await waitFor(
      () => expect(editorRef.current?.getSelection()).toEqual(expect.objectContaining({ from: expect.any(Number) })),
      { timeout: 10_000 }
    )
    await user.click(await screen.findByRole('button', { name: 'Dictate locally' }))
    expect(binding).toMatchObject({ targetId: 'notes:opaque-note-1:preview', sourceEntityId: 'opaque-note-1' })

    act(() => {
      editorRef.current!.replaceRange({ from: 1, to: 1 }, 'draft ')
    })
    act(() => editorRef.current!.executeCommand('setTextSelection', { from: 13, to: 17 }))
    act(() => expect(voiceTargetManager.insert(binding!, '<b>spoken</b>')).toBe('inserted'))

    await waitFor(() =>
      expect(screen.getByLabelText('saved draft')).toHaveTextContent('draft alpha &lt;b&gt;spoken&lt;/b&gt;')
    )
    expect(editorRef.current!.getContent()).toBe('draft alpha <b>spoken</b>')
  })

  it('binds an empty source editor and saves recognized text at its current caret', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.notes.default_edit_mode', 'source')
    let binding: CapturedVoiceTarget | null = null
    vi.spyOn(dictationService, 'startScoped').mockImplementation(() => {
      binding = voiceTargetManager.captureCurrent()
      return { result: Promise.resolve(), cancel: async () => undefined }
    })
    const user = userEvent.setup()
    render(<Note initialContent="" />)
    await waitFor(() => expect(codeEditorRef.current?.getSelection?.()).toEqual({ from: 0, to: 0, text: '' }))
    await user.click(screen.getByRole('button', { name: 'Dictate locally' }))
    expect(binding).toMatchObject({ targetId: 'notes:opaque-note-1:source', sourceEntityId: 'opaque-note-1' })

    const view = EditorView.findFromDOM(screen.getByRole('textbox'))!
    act(() => view.dispatch({ changes: { from: 0, insert: 'draft' }, selection: { anchor: 5 } }))
    act(() => expect(voiceTargetManager.insert(binding!, ' spoken')).toBe('inserted'))

    expect(screen.getByLabelText('saved draft')).toHaveTextContent('draft spoken')
    expect(codeEditorRef.current!.getSelection?.()).toEqual({ from: 12, to: 12, text: '' })
  })

  it('rejects a pending result after switching away and back to the same editing mode', async () => {
    const user = userEvent.setup()
    render(<Note />)
    await waitFor(
      () => expect(editorRef.current?.getSelection()).toEqual(expect.objectContaining({ from: expect.any(Number) })),
      { timeout: 10_000 }
    )
    await user.click(screen.getByRole('button', { name: 'Dictate locally' }))
    const binding = voiceTargetManager.captureCurrent()!
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dictate locally' })).not.toHaveFocus())

    await switchMode(user, 'Source code mode')
    await waitFor(() => expect(codeEditorRef.current?.getSelection?.()).toBeDefined())
    await switchMode(user, 'Live preview')
    await waitFor(() =>
      expect(editorRef.current?.getSelection()).toEqual(expect.objectContaining({ from: expect.any(Number) }))
    )

    expect(voiceTargetManager.insert(binding, 'late result')).toBe('unavailable')
    expect(screen.getByLabelText('saved draft')).toHaveTextContent('alpha beta')
  })

  it('rejects a pending result after selecting a different note or unmounting', async () => {
    const user = userEvent.setup()
    const notes = render(<Note />)
    await waitFor(
      () => expect(editorRef.current?.getSelection()).toEqual(expect.objectContaining({ from: expect.any(Number) })),
      { timeout: 10_000 }
    )
    await user.click(screen.getByRole('button', { name: 'Dictate locally' }))
    const binding = voiceTargetManager.captureCurrent()!

    notes.rerender(<Note id="opaque-note-2" />)
    expect(voiceTargetManager.insert(binding, 'late result')).toBe('unavailable')
    expect(screen.getByLabelText('saved draft')).toHaveTextContent('alpha beta')
    await user.click(screen.getByRole('button', { name: 'Dictate locally' }))
    const nextBinding = voiceTargetManager.captureCurrent()!
    notes.unmount()
    expect(voiceTargetManager.insert(nextBinding, 'late result')).toBe('unavailable')
  })

  it('keeps dictation visible but disabled in reading mode', async () => {
    const user = userEvent.setup()
    render(<Note />)
    await waitFor(
      () => expect(editorRef.current?.getSelection()).toEqual(expect.objectContaining({ from: expect.any(Number) })),
      { timeout: 10_000 }
    )
    await switchMode(user, 'Reading mode')

    expect(screen.getByRole('button', { name: 'Dictate locally' })).toBeDisabled()
    expect(voiceTargetManager.captureCurrent()).toBeNull()
    expect(screen.getByRole('button', { name: 'Read aloud' })).toBeEnabled()
  })

  it('enables explicit recovery insertion when the user focuses the note', async () => {
    vi.spyOn(dictationService, 'getSnapshot').mockReturnValue({
      phase: 'recovery',
      elapsedMs: 0,
      recoveryAvailable: true
    })
    vi.spyOn(dictationService, 'insertRecovery').mockImplementation(() =>
      voiceTargetManager.insertIntoCurrent('recovered text', 'user_recovery')
    )
    const user = userEvent.setup()
    render(<Note />)
    await waitFor(
      () => expect(editorRef.current?.getSelection()).toEqual(expect.objectContaining({ from: expect.any(Number) })),
      { timeout: 10_000 }
    )
    expect(screen.getByRole('button', { name: 'Insert transcript' })).toBeDisabled()

    act(() => editorRef.current!.focus())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Insert transcript' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Insert transcript' }))

    await waitFor(() => expect(screen.getByLabelText('saved draft')).toHaveTextContent('recovered text'))
  })
})
