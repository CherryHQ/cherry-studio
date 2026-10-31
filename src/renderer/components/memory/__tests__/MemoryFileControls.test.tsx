import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MemoryFileControls } from '../MemoryFileControls'

vi.mock('@cherrystudio/ui', () => vi.importActual('@cherrystudio/ui'))

const editor = { editorId: 'editor', maxBytes: 25000, maxLines: 200, warningBytes: 20000, warningLines: 160 }
let disk: Map<string, string>
let active: Set<string>
let conflict: boolean
let recoverable: boolean

beforeEach(() => {
  disk = new Map([
    ['MEMORY.md', 'Private content must not appear'],
    ['.memories/topic.md', 'Topic body']
  ])
  active = new Set()
  conflict = false
  recoverable = false
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
      case 'memory.clear.preview':
        data = { token: 'clear-preview', files: [...disk.keys()].map((path) => ({ path, hash: 'hash' })) }
        break
      case 'memory.clear.confirm':
        if (args.token !== 'clear-preview') throw new Error('Preview required')
        if (conflict) {
          data = {
            batchId: 'partial',
            error: 'conflict',
            files: [{ path: '.memories/topic.md', hash: 'hash', outcome: 'conflict' }]
          }
          break
        }
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
        data = recoverable ? { token: 'recover-preview', files: [{ path: 'MEMORY.md', conflict: false }] } : undefined
        break
      case 'memory.recovery.confirm':
        if (args.token !== 'recover-preview') throw new Error('Recovery preview required')
        disk.set('MEMORY.md', 'Recovered fact')
        data = { batchId: 'recovery', files: [{ path: 'MEMORY.md', hash: 'recovered', outcome: 'applied' }] }
        break
      default:
        throw new Error(`Unexpected route: ${route}`)
    }
    return { ok: true, data }
  })
})

describe('shared memory file controls', () => {
  it('shows only recovery and clear actions without reading or listing files', async () => {
    render(<MemoryFileControls />)
    await waitFor(() => expect(screen.getByRole('button', { name: '清除全局记忆' })).toBeEnabled())
    expect(screen.queryByText('topic')).not.toBeInTheDocument()
    expect(screen.queryByText('记忆文件')).not.toBeInTheDocument()
    expect(screen.queryByText('记忆概览')).not.toBeInTheDocument()
    expect(screen.queryByText('Private content must not appear')).not.toBeInTheDocument()
    expect(screen.queryByText('Topic body')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(vi.mocked(window.api.ipcApi.request).mock.calls.some(([route]) => route.startsWith('memory.file.'))).toBe(
      false
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('confirms clearing without displaying files and leaves content intact on cancel', async () => {
    const user = userEvent.setup()
    render(<MemoryFileControls />)
    await waitFor(() => expect(screen.getByRole('button', { name: '清除全局记忆' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: '清除全局记忆' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('确定清除本地所有记忆文件么？')).toBeVisible()
    expect(within(dialog).queryByRole('list')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('MEMORY.md')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('.memories/topic.md')).not.toBeInTheDocument()
    expect(disk.get('MEMORY.md')).toBe('Private content must not appear')
    await user.click(within(dialog).getByRole('button', { name: '取消' }))
    expect(dialog).toHaveTextContent('确定清除本地所有记忆文件么？')
    expect(dialog).not.toHaveTextContent('恢复备份')
    expect(dialog).not.toHaveTextContent('MEMORY.md')
    expect(disk.get('.memories/topic.md')).toBe('Topic body')
    await user.click(screen.getByRole('button', { name: '清除全局记忆' }))
    const confirmation = await screen.findByRole('dialog')
    await user.click(within(confirmation).getByRole('button', { name: '确认' }))
    expect(confirmation).toHaveTextContent('确定清除本地所有记忆文件么？')
    expect(confirmation).not.toHaveTextContent('恢复备份')
    await waitFor(() => expect(disk.get('MEMORY.md')).toBe(''))
    expect(disk.has('.memories/topic.md')).toBe(false)
    await waitFor(() => expect(screen.getByRole('button', { name: '清除全局记忆' })).toBeEnabled())
    expect(screen.getByRole('status')).toHaveTextContent('清除成功')
    expect(screen.getByRole('status')).not.toHaveTextContent('已保存')
  })

  it('requires confirmation before recovering the last operation', async () => {
    const user = userEvent.setup()
    recoverable = true
    render(<MemoryFileControls />)
    await waitFor(() => expect(screen.getByRole('button', { name: '恢复备份' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: '恢复备份' }))
    expect(within(await screen.findByRole('dialog')).getByText('MEMORY.md')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(disk.get('MEMORY.md')).toBe('Private content must not appear')
    await user.click(screen.getByRole('button', { name: '恢复备份' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '确认' }))
    await waitFor(() => expect(disk.get('MEMORY.md')).toBe('Recovered fact'))
    expect(await screen.findByRole('status')).toHaveTextContent('已保存')
  })

  it('reports a conflicting file instead of a successful save', async () => {
    const user = userEvent.setup()
    conflict = true
    render(<MemoryFileControls />)
    await waitFor(() => expect(screen.getByRole('button', { name: '清除全局记忆' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: '清除全局记忆' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '确认' }))
    expect(await screen.findByRole('alert')).toBeVisible()
    expect(screen.getByRole('list', { name: '文件结果' })).toHaveTextContent('.memories/topic.md')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(disk.get('.memories/topic.md')).toBe('Topic body')
  })

  it('clears the previous success while clearing is pending and does not report a failed clear as successful', async () => {
    const user = userEvent.setup()
    recoverable = true
    render(<MemoryFileControls />)
    await waitFor(() => expect(screen.getByRole('button', { name: '恢复备份' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: '恢复备份' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '确认' }))
    expect(await screen.findByRole('status')).toHaveTextContent('已保存')
    await waitFor(() => expect(screen.getByRole('button', { name: '清除全局记忆' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: '清除全局记忆' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    const saved = Promise.withResolvers<unknown>()
    vi.mocked(window.api.ipcApi.request).mockImplementationOnce(() => saved.promise)
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '确认' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    await act(async () => {
      saved.resolve({ ok: true, data: { error: 'conflict', files: [] } })
    })
    expect(await screen.findByRole('alert')).toBeVisible()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(disk.get('MEMORY.md')).toBe('Recovered fact')
  })

  it.each([true, false])('reports unchanged targets only when clearing fails (failed=%s)', async (failed) => {
    const user = userEvent.setup()
    render(<MemoryFileControls />)
    await waitFor(() => expect(screen.getByRole('button', { name: '清除全局记忆' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: '清除全局记忆' }))
    vi.mocked(window.api.ipcApi.request).mockResolvedValueOnce({
      ok: true,
      data: {
        batchId: 'partial-clear',
        ...(failed ? { error: 'write failed' } : {}),
        files: [
          { path: '.memories/topic.md', hash: null, outcome: 'applied' },
          { path: 'MEMORY.md', hash: 'original', outcome: 'unchanged' }
        ]
      }
    })
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '确认' }))
    if (failed) {
      expect(await screen.findByRole('alert')).toBeVisible()
      const results = screen.getByRole('list', { name: '文件结果' })
      expect(results).toHaveTextContent('MEMORY.md')
      expect(results).not.toHaveTextContent('.memories/topic.md')
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    } else {
      expect(await screen.findByRole('status')).toHaveTextContent('清除成功')
      expect(screen.queryByRole('list', { name: '文件结果' })).not.toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    }
  })
  it('reports when there is no recoverable operation without claiming a save', async () => {
    const user = userEvent.setup()
    render(<MemoryFileControls />)
    await waitFor(() => expect(screen.getByRole('button', { name: '恢复备份' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: '恢复备份' }))
    await screen.findByRole('alert')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '恢复备份' })).toBeEnabled()
  })

  it('releases a late editor handle after the settings page has unmounted', async () => {
    const opened = Promise.withResolvers<unknown>()
    vi.mocked(window.api.ipcApi.request).mockImplementationOnce(() => opened.promise)
    const view = render(<MemoryFileControls />)
    view.unmount()
    await act(async () => {
      active.add(editor.editorId)
      opened.resolve({ ok: true, data: editor })
    })
    await waitFor(() => expect(active.size).toBe(0))
  })
})
