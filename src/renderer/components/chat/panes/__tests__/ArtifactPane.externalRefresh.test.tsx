import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type PropsWithChildren, useMemo, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FileEditSessionContext, useFileEditSession } from '@renderer/hooks/useFileEditSession'
import { FileEditSessionManager } from '@renderer/services/fileEdit/FileEditSessionManager'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { createFilePathHandle } from '@shared/utils/file'

import { createEditTransport } from '../../../../../../tests/helpers/file/editTransport'
import { ArtifactPaneView } from '../ArtifactPane'
import type * as PaneSettings from '../ArtifactPaneSettingsMenu'
import { useArtifactFileTreeModel } from '../useArtifactFileTreeModel'

const bridge = vi.hoisted(() => ({ request: vi.fn(), on: vi.fn() }))
vi.mock('@renderer/ipc', () => ({ ipcApi: bridge }))
// Shared UI stand-ins: primitive behavior is not under test.
vi.mock('@renderer/components/command', () => ({
  CommandContextMenu: ({ children }: PropsWithChildren) => <>{children}</>
}))
vi.mock('@renderer/hooks/useExternalOpenTargets', () => ({
  useExternalOpenTargets: () => ({ targets: [], openTarget: vi.fn() })
}))
vi.mock('@renderer/components/OpenTarget', () => ({
  OpenTargetButton: () => null,
  loadOpenTargetMenuItems: async () => [],
  buildOpenTargetMenuItems: () => []
}))
// Formatting is not under test; the real Markdown loader still reads external file bytes.
vi.mock('@renderer/components/markdown', () => ({
  MarkdownHostProvider: ({ children }: PropsWithChildren) => <>{children}</>,
  StaticMarkdown: ({ children }: { children: string }) => <article>{children}</article>
}))
vi.mock('../ArtifactPaneSettingsMenu', async (original) => ({
  ...(await original<typeof PaneSettings>()),
  ArtifactPaneSettingsMenu: () => null
}))
vi.mock('../ArtifactPaneBreadcrumb', () => ({ ArtifactPaneBreadcrumb: () => null }))
vi.mock('../ArtifactPaneFileTabs', () => ({ ArtifactPaneFileTabs: () => null }))
vi.mock('@renderer/components/FileTree', () => ({ FileTree: () => null }))
vi.mock('@renderer/components/FileEditor', () => ({
  default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea aria-label="Document editor" value={value} onChange={(event) => onChange(event.currentTarget.value)} />
  )
}))
let diskRoot: string
let workspace: string
function onDiskPath(path: string): string {
  if (workspace === diskRoot) return path
  const relative = path.replace(/\\/g, '/').slice(workspace.replace(/\\/g, '/').length)
  return join(diskRoot, relative)
}
let revision: number
const treeStats = new Map<string, boolean>()
const listeners = new Set<(payload: unknown) => void>()

function Pane(props: { nested?: boolean; editing?: boolean; filePath?: string }) {
  const [manager] = useState(() => new FileEditSessionManager())
  return (
    <FileEditSessionContext value={manager}>
      <PaneInner {...props} />
    </FileEditSessionContext>
  )
}

function PaneInner({
  nested = false,
  editing = false,
  filePath
}: {
  nested?: boolean
  editing?: boolean
  filePath?: string
}) {
  const [selected, setSelected] = useState<string | null>(filePath ?? (nested ? 'sub/preview.md' : 'preview.md'))
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set(nested ? ['sub'] : []))
  const [searchKeyword, setSearchKeyword] = useState('')
  const model = useArtifactFileTreeModel({
    workspacePath: workspace,
    treeOpen: true,
    expandedIds,
    searchKeyword,
    enableFileSearch: true,
    selectedFile: selected,
    onExpandedIdsChange: setExpandedIds
  })
  const editHandle = useMemo(
    () =>
      editing && selected ? createFilePathHandle(AbsoluteFilePathSchema.parse(join(workspace, selected))) : undefined,
    [editing, selected]
  )
  const fileSession = useFileEditSession(editHandle, 'preview-regression', { autoSave: false })
  const selection = selected ? { workspacePath: workspace, filePath: selected } : null
  return (
    <>
      <output aria-label="conflict status">{fileSession.conflict ? 'conflict' : 'clear'}</output>
      <output aria-label="draft status">{fileSession.isDirty ? 'dirty' : 'clean'}</output>
      <button type="button" onClick={() => setSelected('other.md')}>
        Other file
      </button>
      <button type="button" onClick={() => setSelected('preview.md')}>
        Preview file
      </button>
      <ArtifactPaneView
        fileSession={fileSession}
        editMode={editing ? 'edit' : 'preview'}
        headerVariant="pane"
        paneTitle="Files"
        paneActions={null}
        workspacePath={workspace}
        model={model}
        selectedFile={selected}
        onSelectedFileChange={setSelected}
        previewFileSelection={selection}
        fileTabs={selection ? [selection] : []}
        onPreviewClose={() => setSelected(null)}
        enableFileSearch
        searchKeyword={searchKeyword}
        onSearchKeywordChange={setSearchKeyword}
      />
    </>
  )
}

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'cherry-preview-refresh-'))
  diskRoot = workspace
  revision = 0
  treeStats.clear()
  listeners.clear()
  await writeFile(join(workspace, 'preview.md'), 'alpha\n')
  await writeFile(join(workspace, 'other.md'), 'other document\n')
  await mkdir(join(workspace, 'sub'))
  await writeFile(join(workspace, 'sub/preview.md'), 'alpha\n')
  bridge.request.mockReset()
  bridge.on.mockImplementation((_event, callback) => {
    listeners.add(callback)
    return () => listeners.delete(callback)
  })
  const editTransport = createEditTransport(async (_route, input) => {
    const path = (input as { path: string }).path
    const content = await readFile(onDiskPath(path))
    const metadata = await stat(onDiskPath(path))
    return { content: new Uint8Array(content), version: { mtime: metadata.mtimeMs, size: metadata.size } }
  })
  bridge.request.mockImplementation(async (route, input) => {
    if (route.startsWith('file.edit.')) return editTransport(route, input)
    if (route === 'file.tree.create') {
      const root = input.rootPath
      treeStats.set(root, input.options?.withStats === true)
      const entries = await readdir(onDiskPath(root), { withFileTypes: true })
      return {
        treeId: root,
        revision: 0,
        snapshot: {
          kind: 'directory',
          path: root,
          basename: 'workspace',
          children: Object.fromEntries(
            entries.map((entry) => [
              entry.name,
              {
                kind: entry.isDirectory() ? 'directory' : 'file',
                path: join(root, entry.name),
                basename: entry.name,
                ...(entry.isDirectory() ? { children: {} } : {})
              }
            ])
          )
        }
      }
    }
    if (route === 'file.tree.activate') return true
    if (route === 'file.tree.dispose') return undefined
    if (route === 'file.get_metadata') {
      const s = await stat(onDiskPath(input.path))
      return { kind: 'file', type: 'text', size: s.size, modifiedAt: s.mtimeMs, createdAt: s.birthtimeMs }
    }
    throw new Error(`Unexpected IPC ${route}`)
  })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      fs: { readText: (path: string) => readFile(onDiskPath(path), 'utf8') },
      file: {
        listDirectoryEntries: async (path: string) =>
          (await readdir(onDiskPath(path), { withFileTypes: true })).map((entry) => ({
            path: join(path, entry.name),
            isDirectory: entry.isDirectory()
          }))
      }
    }
  })
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function changeExternal(content: string, relativePath = 'preview.md', eventPath = relativePath) {
  const path = join(workspace, relativePath)
  await writeFile(onDiskPath(path), content)
  const s = await stat(onDiskPath(path))
  expect(await readFile(onDiskPath(path), 'utf8')).toBe(content)
  await act(async () => {
    const payload = {
      treeId: relativePath.startsWith('sub/') ? join(workspace, 'sub') : workspace,
      revision: ++revision,
      event: {
        type: 'updated',
        path: join(workspace, eventPath),
        stats: { mtime: s.mtimeMs, birthtime: s.birthtimeMs }
      }
    }
    if (treeStats.get(payload.treeId)) {
      for (const listener of listeners) listener(payload)
    }
  })
}

describe('open artifact preview after external edits', () => {
  it.each(['bravo\n', 'a longer externally edited document\n'])(
    'shows fresh bytes after delivered tree event: %j',
    async (content) => {
      render(<Pane />)
      expect(await screen.findByRole('article')).toHaveTextContent('alpha')
      await waitFor(() => expect(listeners.size).toBeGreaterThan(0))
      await changeExternal(content)
      await waitFor(() => expect(screen.getByRole('article')).toHaveTextContent(content.trim()))
    }
  )
  it.each(['C:/work', '\\\\server\\share\\work'])(
    'normalizes native preview and tree event paths for %s',
    async (virtualRoot) => {
      workspace = virtualRoot
      render(<Pane />)
      expect(await screen.findByRole('article')).toHaveTextContent('alpha')
      await changeExternal('bravo\n')
      await waitFor(() => expect(screen.getByRole('article')).toHaveTextContent('bravo'))
    }
  )
  it('preserves a literal POSIX backslash instead of matching a different nested path', async () => {
    const filePath = 'sub\\preview.md'
    await writeFile(join(workspace, filePath), 'alpha\n')
    render(<Pane filePath={filePath} />)
    expect(await screen.findByRole('article')).toHaveTextContent('alpha')
    await changeExternal('bravo\n', filePath, 'sub/preview.md')
    expect(screen.getByRole('article')).toHaveTextContent('alpha')
    await changeExternal('bravo\n', filePath)
    await waitFor(() => expect(screen.getByRole('article')).toHaveTextContent('bravo'))
  })
  it('refreshes an opened file from its lazy subdirectory watcher', async () => {
    render(<Pane nested />)
    expect(await screen.findByRole('article')).toHaveTextContent('alpha')
    await waitFor(() =>
      expect(bridge.request).toHaveBeenCalledWith(
        'file.tree.activate',
        expect.objectContaining({ treeId: join(workspace, 'sub') })
      )
    )
    await changeExternal('bravo\n', 'sub/preview.md')
    await waitFor(() => expect(screen.getByRole('article')).toHaveTextContent('bravo'))
  })
  it('does not discard displayed content on an unrelated file event', async () => {
    render(<Pane />)
    expect(await screen.findByRole('article')).toHaveTextContent('alpha')
    await changeExternal('bravo\n', 'preview.md', 'other.md')
    expect(screen.getByRole('article')).toHaveTextContent('alpha')
    await changeExternal('bravo\n')
    await waitFor(() => expect(screen.getByRole('article')).toHaveTextContent('bravo'))
  })
  it('keeps a dirty edit draft when a watched external change arrives and focus returns', async () => {
    const user = userEvent.setup()
    render(<Pane editing />)
    const editor = await screen.findByRole('textbox', { name: 'Document editor' })
    await waitFor(() => expect(editor).toHaveValue('alpha\n'))
    await user.clear(editor)
    await user.type(editor, 'unsaved local draft')
    expect(screen.getByLabelText('draft status')).toHaveTextContent('dirty')
    await changeExternal('bravo\n')
    fireEvent.focus(window)
    await waitFor(() => expect(screen.getByLabelText('conflict status')).toHaveTextContent('conflict'))
    expect(editor).toHaveValue('unsaved local draft')
    expect(screen.getByLabelText('draft status')).toHaveTextContent('dirty')
    expect(await readFile(join(workspace, 'preview.md'), 'utf8')).toBe('bravo\n')
  })
  it('does not replace a new file selection when an obsolete refresh read settles', async () => {
    const user = userEvent.setup()
    render(<Pane />)
    expect(await screen.findByRole('article')).toHaveTextContent('alpha')
    const delayed = Promise.withResolvers<string>()
    const read = vi.spyOn(window.api.fs, 'readText').mockImplementationOnce(() => delayed.promise)
    await changeExternal('bravo\n')
    await waitFor(() => expect(read).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: 'Other file' }))
    await waitFor(() => expect(screen.getByRole('article')).toHaveTextContent('other document'))
    await act(async () => delayed.resolve('bravo\n'))
    expect(screen.getByRole('article')).toHaveTextContent('other document')
  })
  it('control: switching files recovers the external bytes', async () => {
    const user = userEvent.setup()
    render(<Pane />)
    expect(await screen.findByRole('article')).toHaveTextContent('alpha')
    await changeExternal('bravo\n')
    await user.click(screen.getByRole('button', { name: 'Other file' }))
    await waitFor(() => expect(screen.getByRole('article')).toHaveTextContent('other document'))
    await user.click(screen.getByRole('button', { name: 'Preview file' }))
    await waitFor(() => expect(screen.getByRole('article')).toHaveTextContent('bravo'))
  })
})
