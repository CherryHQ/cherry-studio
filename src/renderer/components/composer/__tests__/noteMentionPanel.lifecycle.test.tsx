import { mockDataApiService } from '@test-mocks/renderer/DataApiService'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useMemo, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { QuickPanelProvider } from '@renderer/components/QuickPanel'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import type { CreateTreeIpcResult, SerializedTreeNode } from '@shared/utils/file'

import ComposerSurface from '../ComposerSurfaceRuntime'
import { ComposerToolRuntimeProvider } from '../ComposerToolRuntime'
import { useNoteReferenceMentionItems } from '../variants/chat/useNoteReferenceMentionItems'
import { useEntityReferenceMentionSource } from '../variants/shared/useEntityReferenceMentionSource'

// Keep the editor, suggestion plugin, panel provider/view and directory hook real.
// Only the IPC boundary supplies synthetic notes; no local Notes directory is read.
const ipc = vi.hoisted(() => ({ create: vi.fn(), dispose: vi.fn(), unsubscribe: vi.fn() }))

vi.mock('@cherrystudio/ui', (importOriginal) => importOriginal())

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: (route: string, input: { treeId: string }) => {
      if (route === 'app.get_info') return Promise.resolve({ notesPath: '/default-notes' })
      if (route === 'file.validate_notes_directory') return Promise.resolve(true)
      if (route === 'file.tree.create') return ipc.create(input)
      if (route === 'file.tree.activate') return Promise.resolve(true)
      if (route === 'file.tree.dispose') return ipc.dispose(input.treeId)
      throw new Error(`Unexpected route ${route}`)
    },
    on: () => ipc.unsubscribe
  }
}))

function snapshot(treeId: string, name: string): CreateTreeIpcResult {
  const file: SerializedTreeNode = { kind: 'file', path: `/configured-notes/${name}.md`, basename: `${name}.md` }
  return {
    treeId,
    revision: 0,
    snapshot: {
      kind: 'directory',
      path: '/configured-notes',
      basename: 'configured-notes',
      children: { [file.basename]: file }
    }
  }
}

function NoteComposer() {
  const [text, setText] = useState('')
  const [files, setFiles] = useState<ComposerAttachment[]>([])
  const { getItems, onExit } = useNoteReferenceMentionItems({ files, setFiles })
  const additionalItems = useMemo(() => ({ getItems, onExit, title: 'Notes' }), [getItems, onExit])
  const { sources } = useEntityReferenceMentionSource({ entityType: 'topic', additionalItems })

  return (
    <>
      <button type="button">Outside the composer</button>
      <ComposerSurface
        text={text}
        onTextChange={setText}
        tokens={[]}
        managedTokenKinds={[]}
        onTokensChange={() => undefined}
        placeholder="Message"
        sendDisabled
        isLoading={false}
        onSendDraft={() => undefined}
        onPause={() => undefined}
        supportedExts={[]}
        setFiles={setFiles}
        filesCount={files.length}
        isExpanded={false}
        onExpandedChange={() => undefined}
        quickPanelEnabled
        enableDragDrop={false}
        enableSpellCheck={false}
        fontSize={14}
        narrowMode={false}
        suggestionSources={sources}
      />
    </>
  )
}

function renderNoteComposer() {
  const { container } = render(
    <QuickPanelProvider>
      <ComposerToolRuntimeProvider actions={{ addNewTopic: () => undefined, onTextChange: () => undefined }}>
        <NoteComposer />
      </ComposerToolRuntimeProvider>
    </QuickPanelProvider>
  )
  const input = container.querySelector<HTMLElement>('[contenteditable="true"]')!
  expect(input).not.toBeNull()
  act(() => input.focus())
  return input
}

describe('Notes mention panel dismissal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setPreferenceValue('feature.notes.path', '/configured-notes')
    ipc.dispose.mockResolvedValue(undefined)
    ipc.create.mockResolvedValue(snapshot('first-tree', 'First'))
    mockDataApiService.get.mockImplementation(async (path) => {
      if (path === '/topics') return { items: [] }
      if (path === '/search/entities') return { groups: [] }
      throw new Error(`Unexpected DataApi path ${path}`)
    })
    // jsdom has no layout; give the real virtual list a viewport.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(300)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(600)
    vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined)
    const createRange = document.createRange.bind(document)
    vi.spyOn(document, 'createRange').mockImplementation(() => {
      const rect = new DOMRect(0, 0, 600, 20)
      return Object.assign(createRange(), {
        getBoundingClientRect: () => rect,
        getClientRects: () => Object.assign([rect], { item: (index: number) => (index === 0 ? rect : null) })
      })
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it.each(['outside click', 'Escape'])(
    'releases the directory watcher after %s and reloads notes when reopened',
    async (dismissal) => {
      const user = userEvent.setup()
      const input = renderNoteComposer()
      await user.keyboard('@')
      await screen.findByText('First')

      if (dismissal === 'outside click') {
        await user.click(screen.getByRole('button', { name: 'Outside the composer' }))
      } else {
        await user.keyboard('{Escape}')
      }

      await waitFor(() => expect(ipc.dispose).toHaveBeenCalledWith('first-tree'))
      expect(ipc.unsubscribe).toHaveBeenCalled()
      expect(input).toHaveTextContent('@')
      await waitFor(() => expect(screen.queryByText('First')).not.toBeInTheDocument())

      ipc.create.mockResolvedValue(snapshot('reopened-tree', 'Fresh'))
      await user.click(screen.getByRole('button', { name: 'Outside the composer' }))
      await act(async () => input.focus())
      expect(ipc.create).toHaveBeenCalledTimes(1)
      await user.keyboard('{Backspace}')
      await waitFor(() => expect(input.textContent).toBe(''))
      await user.keyboard('@')
      await screen.findByText('Fresh')
      expect(ipc.dispose).not.toHaveBeenCalledWith('reopened-tree')
    }
  )

  it.each(['outside click', 'Escape'])(
    'releases Notes on %s while a newer topic query is pending and ignores its late results',
    async (dismissal) => {
      let finishSearch!: (value: { groups: [] }) => void
      const search = new Promise<{ groups: [] }>((resolve) => {
        finishSearch = resolve
      })
      const user = userEvent.setup()
      const input = renderNoteComposer()
      await user.keyboard('@')
      await screen.findByText('First')

      mockDataApiService.get.mockReturnValueOnce(search)
      await user.keyboard('f')
      await waitFor(() =>
        expect(mockDataApiService.get).toHaveBeenCalledWith('/search/entities', {
          query: { q: 'f', types: ['topic'], limitPerType: 50 }
        })
      )
      // The panel still displays the settled empty-query results while topic search waits.
      expect(screen.getByText('First')).toBeInTheDocument()
      if (dismissal === 'outside click') {
        await user.click(screen.getByRole('button', { name: 'Outside the composer' }))
      } else {
        await user.keyboard('{Escape}')
      }

      await waitFor(() => expect(ipc.dispose).toHaveBeenCalledWith('first-tree'))
      expect(ipc.unsubscribe).toHaveBeenCalled()
      expect(input.textContent).toBe('@f')
      await act(async () => finishSearch({ groups: [] }))
      await waitFor(() => expect(screen.queryByText('First')).not.toBeInTheDocument())
      expect(screen.getByTestId('quick-panel')).toHaveAttribute('inert')
      expect(ipc.create).toHaveBeenCalledTimes(1)

      ipc.create.mockResolvedValue(snapshot('reopened-tree', 'Fresh'))
      await user.click(screen.getByRole('button', { name: 'Outside the composer' }))
      await act(async () => input.focus())
      expect(ipc.create).toHaveBeenCalledTimes(1)
      await user.keyboard('{Backspace}{Backspace}')
      await waitFor(() => expect(input.textContent).toBe(''))
      await user.keyboard('@')
      await screen.findByText('Fresh')
      expect(ipc.dispose).not.toHaveBeenCalledWith('reopened-tree')
    }
  )
})
