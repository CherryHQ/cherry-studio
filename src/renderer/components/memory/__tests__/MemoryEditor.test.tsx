import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { MemoryEditor } from '../MemoryEditor'

vi.mock('@cherrystudio/ui', () => vi.importActual('@cherrystudio/ui'))
vi.mock('@tanstack/react-router', () => ({ useBlocker: () => ({ status: 'idle' }) }))

const editor = { editorId: 'editor', maxBytes: 25000, maxLines: 200, warningBytes: 20000, warningLines: 160 }
let disk: Map<string, string>
let failSave: boolean
let active: Set<string>

beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture ??= () => false
  HTMLElement.prototype.releasePointerCapture ??= () => {}
  HTMLElement.prototype.setPointerCapture ??= () => {}
  HTMLElement.prototype.scrollIntoView ??= () => {}
})

beforeEach(() => {
  disk = new Map([
    ['MEMORY.md', 'Original'],
    ['.memories/topic.md', 'Topic']
  ])
  active = new Set()
  failSave = false
  vi.mocked(window.api.ipcApi.request).mockImplementation(async (route, input) => {
    const args = input as { path?: string; content?: string; editorId?: string; token?: string }
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
        data = { path: args.path, content: disk.get(args.path!) ?? null, hash: 'hash', receipt: 'read' }
        break
      case 'memory.file.write':
        if (failSave)
          return {
            ok: false,
            error: { code: 'MEMORY_OPERATION_FAILED', message: 'Conflict', data: { reason: 'conflict' } }
          }
        disk.set('MEMORY.md', args.content!)
        data = { batchId: 'batch', files: [{ path: 'MEMORY.md', hash: 'new', outcome: 'applied' }] }
        break
      case 'memory.clear.preview':
        data = { token: 'preview', files: [...disk.keys()].map((path) => ({ path, hash: 'hash' })) }
        break
      case 'memory.clear.confirm':
        if (args.token !== 'preview') throw new Error('Preview required')
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
      default:
        throw new Error(`Unexpected route: ${route}`)
    }
    return { ok: true, data }
  })
})

describe('memory editor draft and confirmation', () => {
  it('keeps an unsaved draft after a stale save and allows explicit reload confirmation', async () => {
    const user = userEvent.setup()
    render(<MemoryEditor scope={{ kind: 'shared' }} />)
    const textarea = await screen.findByRole('textbox', { name: '记忆概览' })
    await user.clear(textarea)
    await user.type(textarea, 'My local draft')
    failSave = true
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('文件')
    expect(textarea).toHaveValue('My local draft')
    expect(disk.get('MEMORY.md')).toBe('Original')
    await user.click(screen.getByRole('button', { name: '更多' }))
    await user.click(screen.getByRole('menuitem', { name: '刷新' }))
    expect(screen.getByRole('dialog')).toBeVisible()
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '取消' }))
    expect(textarea).toHaveValue('My local draft')
  })

  it('shows the exact clear file set before confirmation and keeps the original on cancel', async () => {
    const user = userEvent.setup()
    render(<MemoryEditor scope={{ kind: 'shared' }} />)
    await screen.findByRole('textbox', { name: '记忆概览' })
    await user.click(screen.getByRole('button', { name: '更多' }))
    await user.click(screen.getByRole('menuitem', { name: '清空共享记忆' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('.memories/topic.md')).toBeVisible()
    expect(within(dialog).getByText('MEMORY.md')).toBeVisible()
    expect(disk.get('MEMORY.md')).toBe('Original')
    await user.click(within(dialog).getByRole('button', { name: '取消' }))
    expect(disk.get('.memories/topic.md')).toBe('Topic')
    await user.click(screen.getByRole('button', { name: '更多' }))
    await user.click(screen.getByRole('menuitem', { name: '清空共享记忆' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '确认' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: '记忆概览' })).toHaveValue(''))
    expect(disk.has('.memories/topic.md')).toBe(false)
    expect(screen.queryByRole('list', { name: '文件结果' })).not.toBeInTheDocument()
  })

  it('measures UTF-8 bytes and preserves oversized drafts instead of silently truncating', async () => {
    render(<MemoryEditor scope={{ kind: 'shared' }} />)
    const textarea = await screen.findByRole('textbox', { name: '记忆概览' })
    const oversized = '记'.repeat(9000)
    fireEvent.change(textarea, { target: { value: oversized } })
    expect(textarea).toHaveValue(oversized)
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('记忆内容过长')
    expect(disk.get('MEMORY.md')).toBe('Original')
  })

  it('does not offer shared clearing in a private editor', async () => {
    const user = userEvent.setup()
    render(<MemoryEditor scope={{ kind: 'private', agentId: 'a' }} />)
    await screen.findByRole('textbox', { name: '记忆概览' })
    await user.click(screen.getByRole('button', { name: '更多' }))
    expect(screen.queryByRole('menuitem', { name: '清空共享记忆' })).not.toBeInTheDocument()
  })

  it('opens a full topic from the compact selector and confirms before discarding its draft', async () => {
    const user = userEvent.setup()
    render(<MemoryEditor scope={{ kind: 'shared' }} />)
    await screen.findByRole('textbox', { name: '记忆概览' })
    await user.click(screen.getByRole('combobox', { name: '记忆文件' }))
    await user.click(screen.getByRole('option', { name: 'topic' }))
    const textarea = await screen.findByRole('textbox', { name: 'topic' })
    expect(textarea).toHaveValue('Topic')
    await user.type(textarea, ' draft')
    await user.click(screen.getByRole('combobox', { name: '记忆文件' }))
    await user.click(screen.getByRole('option', { name: '记忆概览' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '取消' }))
    expect(textarea).toHaveValue('Topic draft')
    expect(disk.get('.memories/topic.md')).toBe('Topic')
  })

  it('releases an editor opened after its component has already unmounted', async () => {
    let resolve!: (value: unknown) => void
    vi.mocked(window.api.ipcApi.request).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    const view = render(<MemoryEditor scope={{ kind: 'shared' }} />)
    view.unmount()
    await act(async () => {
      active.add(editor.editorId)
      resolve({ ok: true, data: editor })
    })
    await waitFor(() => expect(active.size).toBe(0))
  })
})
