import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MemoryFileControls } from '../MemoryFileControls'

vi.mock('@cherrystudio/ui', () => vi.importActual('@cherrystudio/ui'))

const editor = { editorId: 'editor', maxBytes: 25000, maxLines: 200, warningBytes: 20000, warningLines: 160 }
let disk: Map<string, string>
let active: Set<string>
let conflict: boolean

beforeEach(() => {
  disk = new Map([
    ['MEMORY.md', 'Private content must not appear'],
    ['.memories/topic.md', 'Topic body']
  ])
  active = new Set()
  conflict = false
  vi.mocked(window.api.ipcApi.request).mockImplementation(async (route, input) => {
    const args = input as { editorId?: string; path?: string; receipt?: string; token?: string }
    let data: unknown
    switch (route) {
      case 'memory.editor.open':
        active.add(editor.editorId)
        data = editor
        break
      case 'memory.editor.close':
        active.delete(args.editorId!)
        break
      case 'memory.file.list':
        data = [...disk.keys()]
        break
      case 'memory.file.read':
        data = { path: args.path, content: disk.get(args.path!) ?? null, hash: 'hash', receipt: args.path }
        break
      case 'memory.file.delete':
        if (conflict)
          data = {
            batchId: 'partial',
            error: 'conflict',
            files: [{ path: args.receipt, hash: 'hash', outcome: 'conflict' }]
          }
        else {
          disk.delete(args.receipt!)
          data = { batchId: 'delete', files: [{ path: args.receipt, hash: null, outcome: 'applied' }] }
        }
        break
      case 'memory.clear.preview':
        data = { token: 'clear-preview', files: [...disk.keys()].map((path) => ({ path, hash: 'hash' })) }
        break
      case 'memory.clear.confirm':
        if (args.token !== 'clear-preview') throw new Error('Preview required')
        disk.set('MEMORY.md', '')
        disk.delete('.memories/topic.md')
        data = {
          batchId: 'clear',
          files: [
            { path: 'MEMORY.md', hash: 'empty', outcome: 'applied' },
            { path: '.memories/topic.md', hash: null, outcome: 'applied' }
          ]
        }
        break
      case 'memory.recovery.preview':
        data = undefined
        break
      default:
        throw new Error(`Unexpected route: ${route}`)
    }
    return { ok: true, data }
  })
})

describe('shared memory file controls', () => {
  it('shows file names without fetching or previewing memory bodies', async () => {
    render(<MemoryFileControls />)
    expect(await screen.findByText('topic')).toBeVisible()
    expect(screen.queryByText('Private content must not appear')).not.toBeInTheDocument()
    expect(screen.queryByText('Topic body')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(vi.mocked(window.api.ipcApi.request).mock.calls.some(([route]) => route === 'memory.file.read')).toBe(false)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('binds global clearing to the displayed file set and leaves content intact on cancel', async () => {
    const user = userEvent.setup()
    render(<MemoryFileControls />)
    await screen.findByText('topic')
    await user.click(screen.getByRole('button', { name: '清除全局记忆' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('MEMORY.md')).toBeVisible()
    expect(within(dialog).getByText('.memories/topic.md')).toBeVisible()
    expect(disk.get('MEMORY.md')).toBe('Private content must not appear')
    await user.click(within(dialog).getByRole('button', { name: '取消' }))
    expect(disk.get('.memories/topic.md')).toBe('Topic body')
    await user.click(screen.getByRole('button', { name: '清除全局记忆' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '确认' }))
    await waitFor(() => expect(disk.get('MEMORY.md')).toBe(''))
    expect(disk.has('.memories/topic.md')).toBe(false)
    expect(await screen.findByRole('status')).toHaveTextContent('已保存')
  })

  it('does not delete a selected topic until confirmation and never displays its read body', async () => {
    const user = userEvent.setup()
    render(<MemoryFileControls />)
    await screen.findByText('topic')
    await user.click(screen.getByRole('button', { name: '删除' }))
    expect(within(await screen.findByRole('dialog')).getByText('.memories/topic.md')).toBeVisible()
    expect(screen.queryByText('Topic body')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(disk.get('.memories/topic.md')).toBe('Topic body')
    await user.click(screen.getByRole('button', { name: '删除' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '确认' }))
    await waitFor(() => expect(screen.queryByText('topic')).not.toBeInTheDocument())
    expect(disk.get('MEMORY.md')).toBe('Private content must not appear')
  })

  it('reports a conflicting file instead of a successful save', async () => {
    const user = userEvent.setup()
    conflict = true
    render(<MemoryFileControls />)
    await screen.findByText('topic')
    await user.click(screen.getByRole('button', { name: '删除' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '确认' }))
    expect(await screen.findByRole('alert')).toBeVisible()
    expect(screen.getByRole('list', { name: '文件结果' })).toHaveTextContent('.memories/topic.md')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(disk.get('.memories/topic.md')).toBe('Topic body')
  })

  it('keeps recovery available when listing files fails', async () => {
    const request = vi.mocked(window.api.ipcApi.request)
    const normal = request.getMockImplementation()!
    request.mockImplementation((route, input) =>
      route === 'memory.file.list'
        ? Promise.resolve({ ok: false, error: { code: 'MEMORY_OPERATION_FAILED', message: 'Unavailable' } })
        : normal(route, input)
    )
    render(<MemoryFileControls />)
    await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: '恢复最近一次操作' })).toBeEnabled()
  })

  it('releases a late editor handle after the settings page has unmounted', async () => {
    const opened = Promise.withResolvers<unknown>()
    vi.mocked(window.api.ipcApi.request).mockImplementationOnce(() => opened.promise as never)
    const view = render(<MemoryFileControls />)
    view.unmount()
    await act(async () => {
      active.add(editor.editorId)
      opened.resolve({ ok: true, data: editor })
    })
    await waitFor(() => expect(active.size).toBe(0))
  })
})
