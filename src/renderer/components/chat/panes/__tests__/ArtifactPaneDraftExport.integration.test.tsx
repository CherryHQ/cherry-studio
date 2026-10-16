import { mockPreferenceState } from '@test-mocks/renderer/PreferenceService'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { CommandContextKeyProvider, CommandProvider } from '@renderer/components/command'
import type { FileTreeNode } from '@renderer/components/FileTree'
import type { FileEditSession } from '@renderer/hooks/useFileEditSession'

import { ArtifactPaneView } from '../ArtifactPane'
import type { ArtifactFileTreeModel } from '../useArtifactFileTreeModel'

// Opt out of the global UI stand-in so FileTree keeps the real TreeView.
// CodeEditor is no longer what this pane mounts.
vi.mock('@cherrystudio/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof CherryStudioUi>())
}))
vi.mock('@renderer/components/LazyCodeEditor', () => ({
  LazyCodeEditor: () => null
}))
vi.mock('@renderer/components/FilePreview', () => ({
  useOptionalOpenFilePreviewTab: () => undefined,
  FilePreview: () => null
}))
vi.mock('@renderer/hooks/useCodeStyle', () => ({ useCmTheme: () => 'light' }))
// JSDOM has no layout; keep the real tree rows and menus while rendering every row.
vi.mock('@renderer/components/VirtualList', () => ({
  DynamicVirtualList: ({
    list,
    children
  }: {
    list: unknown[]
    children: (item: unknown, index: number) => ReactNode
  }) => <>{list.map(children)}</>
}))

const request = vi.fn()
const showNativePopupMenu = vi.fn()
const draft = '# Unsaved report\n\nLatest changes after autosave failed'

beforeEach(() => {
  vi.clearAllMocks()
  mockPreferenceState.set('menu.presentation_mode', 'native')
  request.mockImplementation(async (route: string) => {
    if (route === 'file.get_metadata') return { ok: true, data: { kind: 'file', type: 'text', size: 30 } }
    if (route === 'external_app.target.list') return { ok: true, data: { pathKind: 'file', targets: [] } }
    return { ok: true, data: null }
  })
  showNativePopupMenu.mockResolvedValue({ type: 'custom', id: 'artifact.export.pdf' })
  Object.assign(window.api, { ipcApi: { request }, command: { showNativePopupMenu } })
})

afterEach(() => {
  cleanup()
  mockPreferenceState.delete('menu.presentation_mode')
})

function renderDraft(workspacePath: string) {
  const nodes: FileTreeNode[] = ['report.md', 'other.md'].map((name) => ({
    id: name,
    name,
    kind: 'file',
    path: name
  }))
  const model: ArtifactFileTreeModel = {
    filteredTree: nodes,
    effectiveExpandedIds: new Set(),
    nodeById: new Map(nodes.map((node) => [node.id, node])),
    isLoading: false,
    hasLoaded: true,
    setExpandedIds: vi.fn(),
    reloadExpandedDirectories: vi.fn(),
    refresh: vi.fn()
  }
  const fileSession: FileEditSession = {
    status: 'ready',
    savedContent: 'Saved report',
    draft,
    isDirty: true,
    isSaving: false,
    conflict: false,
    saveError: new Error('Autosave failed'),
    metadataRecoveryPending: false,
    setDraft: vi.fn(),
    discard: vi.fn(),
    reload: vi.fn(),
    keepDraft: vi.fn(),
    flush: vi.fn(),
    notifyExternalChange: vi.fn()
  }
  render(
    <CommandContextKeyProvider>
      <CommandProvider>
        <ArtifactPaneView
          workspacePath={workspacePath}
          selectedFile="report.md"
          onSelectedFileChange={vi.fn()}
          model={model}
          searchKeyword=""
          onSearchKeywordChange={vi.fn()}
          editMode="edit"
          fileSession={fileSession}
        />
      </CommandProvider>
    </CommandContextKeyProvider>
  )
}

describe('ArtifactPane tree export of unsaved drafts', () => {
  it.each([
    String.raw`C:\workspace`,
    String.raw`\\server\share\workspace`,
    '//server/share/workspace',
    '/tmp/workspace'
  ])('exports the current draft only for the matching tree file in %s', async (workspacePath) => {
    renderDraft(workspacePath)
    const report = screen.getByRole('treeitem', { name: 'report.md' })
    report.focus()
    expect(report).toHaveFocus()
    fireEvent.contextMenu(report)
    await waitFor(() => {
      expect(request).toHaveBeenCalledWith('export.document.convert_and_save', {
        filePath: `${workspacePath}/report.md`,
        sourcePath: `${workspacePath}/report.md`,
        assetRoot: workspacePath,
        defaultName: 'report.md',
        format: 'pdf',
        markdown: undefined,
        draft
      })
    })

    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'other.md' }))
    await waitFor(() => {
      expect(request).toHaveBeenCalledWith('export.document.convert_and_save', {
        filePath: `${workspacePath}/other.md`,
        sourcePath: `${workspacePath}/other.md`,
        assetRoot: workspacePath,
        defaultName: 'other.md',
        format: 'pdf',
        markdown: undefined
      })
    })
  })
})
