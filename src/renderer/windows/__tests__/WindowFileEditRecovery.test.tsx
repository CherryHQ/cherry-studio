import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { FileEditRecovery, FileEditSessionProvider } from '@renderer/components/FileEditSessionProvider'
import { useCache } from '@renderer/data/hooks/useCache'
import { useFileEditSession } from '@renderer/hooks/useFileEditSession'
import { fileErrorCodes } from '@shared/ipc/errors/file'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { fileEditRequestSchemas } from '@shared/ipc/schemas/fileEdit'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import { createEditTransport } from '../../../../tests/helpers/file/editTransport'
import { WindowFileEditRecovery } from '../WindowFileEditRecovery'

vi.unmock('@cherrystudio/ui')
const ipc = vi.hoisted(() => ({ request: vi.fn(), on: vi.fn(() => () => {}) }))
const navigation = vi.hoisted(() => ({ openTab: vi.fn() }))
vi.mock('@renderer/ipc', () => ({ ipcApi: ipc }))
vi.mock('@renderer/hooks/tab', () => ({ useTabs: () => navigation }))
const handle = { kind: 'path', path: AbsoluteFilePathSchema.parse('/notes/A.md') } as const
let disk: string
let fail: boolean
let conflict: boolean
let saving: Promise<void> | undefined

function Editor({ ownerId }: { ownerId: string }) {
  const session = useFileEditSession(handle, ownerId)
  return (
    <textarea
      aria-label="draft"
      value={session.draft}
      readOnly={session.readOnly}
      onChange={(event) => session.setDraft(event.target.value)}
    />
  )
}

function ActivePath() {
  const [path] = useCache('notes.active_file_path')
  return <output aria-label="selected note">{path}</output>
}

function View({
  visible,
  reopenNotes = false,
  ownerId = 'notes'
}: {
  visible: boolean
  reopenNotes?: boolean
  ownerId?: string
}) {
  return (
    <FileEditSessionProvider>
      {visible && <Editor ownerId={ownerId} />}
      <ActivePath />
      {reopenNotes ? <WindowFileEditRecovery /> : <FileEditRecovery />}
    </FileEditSessionProvider>
  )
}

beforeEach(() => {
  MockUseCacheUtils.resetMocks()
  disk = 'original'
  fail = false
  conflict = false
  saving = undefined
  ipc.request.mockImplementation(
    createEditTransport(async (route, input) => {
      if (route === 'file.edit.read')
        return { content: new TextEncoder().encode(disk), version: { mtime: 1, size: disk.length } }
      if (route === 'file.edit.write') {
        await saving
        if (fail) throw new Error('disk full')
        if (conflict) throw new IpcError(fileErrorCodes.STALE_VERSION, 'External edit')
        disk = new TextDecoder().decode(fileEditRequestSchemas[route].input.parse(input).data)
        return { mtime: 2, size: disk.length }
      }
      throw new Error(`Unexpected ${route}`)
    })
  )
})
afterEach(cleanup)

async function edit(ownerId = 'notes') {
  const user = userEvent.setup()
  const view = render(<View visible ownerId={ownerId} />)
  const editor = screen.getByRole('textbox', { name: 'draft' })
  await waitFor(() => expect(editor).toHaveValue('original'))
  await user.clear(editor)
  await user.type(editor, 'changed')
  return { user, view }
}

// A pending detached write must not be presented as a failure or lose its draft.
it('saves a detached draft without a failure alert while the write is pending', async () => {
  const { view } = await edit()
  const pending = Promise.withResolvers<void>()
  saving = pending.promise
  view.rerender(<View visible={false} />)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(disk).toBe('original')
  await act(async () => pending.resolve())
  await waitFor(() => expect(disk).toBe('changed'))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  view.rerender(<View visible />)
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'draft' })).toHaveValue('changed'))
})

// A failed save after view detachment must remain recoverable, and discard needs explicit consent.
it.each(['retry', 'discard'] as const)('recovers a detached failed draft through %s', async (action) => {
  const { user, view } = await edit()
  fail = true
  view.rerender(<View visible={false} />)
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('/notes/A.md')
  await waitFor(() => expect(screen.getByRole('button', { name: '重试' })).toBeEnabled())
  expect(disk).toBe('original')
  if (action === 'discard') {
    await user.click(within(alert).getByRole('button', { name: '放弃修改' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('/notes/A.md')
    await user.click(within(dialog).getByRole('button', { name: '取消' }))
    expect(screen.getByRole('alert')).toBeVisible()
    view.rerender(<View visible />)
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'draft' })).toHaveValue('changed'))
    view.rerender(<View visible={false} />)
    await user.click(within(await screen.findByRole('alert')).getByRole('button', { name: '放弃修改' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '放弃修改' }))
  } else {
    fail = false
    await user.click(screen.getByRole('button', { name: '重试' }))
  }
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  expect(disk).toBe(action === 'retry' ? 'changed' : 'original')
  view.rerender(<View visible />)
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'draft' })).toHaveValue(disk))
})

// Conflict recovery must not offer a retry that can never succeed or overwrite external edits.
it.each(['notes', 'skill:test', 'agent-artifact:test'])(
  'offers Notes navigation only for a Notes conflict (%s)',
  async (ownerId) => {
    const { user, view } = await edit(ownerId)
    disk = 'external'
    conflict = true
    view.rerender(<View visible={false} reopenNotes ownerId={ownerId} />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('磁盘上的文件已发生变化')
    expect(within(alert).queryByRole('button', { name: '重试' })).not.toBeInTheDocument()
    if (ownerId === 'notes') {
      await user.click(within(alert).getByRole('button', { name: '打开' }))
      view.rerender(<View visible ownerId={ownerId} />)
      expect(screen.getByRole('status', { name: 'selected note' })).toHaveTextContent('/notes/A.md')
      expect(navigation.openTab).toHaveBeenCalledWith('/app/notes')
    } else {
      expect(within(alert).queryByRole('button', { name: '打开' })).not.toBeInTheDocument()
      expect(navigation.openTab).not.toHaveBeenCalled()
      expect(screen.getByRole('status', { name: 'selected note' })).toBeEmptyDOMElement()
      view.rerender(<View visible ownerId={ownerId} />)
    }
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'draft' })).toHaveValue('changed'))
    expect(disk).toBe('external')
  }
)
