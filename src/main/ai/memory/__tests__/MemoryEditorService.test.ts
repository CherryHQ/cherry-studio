import { mkdtemp, readFile, readdir, rmdir, unlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { MockApplicationUtils } from '@test-mocks/main/application'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { BaseService, Emitter } from '@main/core/lifecycle'
import { memoryHandlers } from '@main/ipc/handlers/memory'

import { MemoryEditorService } from '../MemoryEditorService'
import { MemoryService } from '../MemoryService'

let fixture: string
let memory: MemoryService
let editors: MemoryEditorService
let windows: Set<string>
let destroyed: Emitter<{ id: string }>
const main = { senderId: 'main' }

async function removeFixture(directory: string): Promise<void> {
  if (directory !== fixture && !directory.startsWith(`${fixture}${path.sep}`)) throw new Error('Outside fixture')
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory() && !entry.isSymbolicLink()) await removeFixture(target)
    else await unlink(target)
  }
  await rmdir(directory)
}

beforeEach(async () => {
  BaseService.resetInstances()
  fixture = await mkdtemp(path.join(os.tmpdir(), 'cherry-memory-editor-'))
  vi.spyOn(application, 'getPath').mockImplementation((key, name) => path.join(fixture, key, name ?? ''))
  windows = new Set(['main', 'second', 'quick'])
  destroyed = new Emitter()
  MockApplicationUtils.setService('WindowManager', {
    getWindow: (id: string) => (windows.has(id) ? {} : undefined),
    getWindowType: (id: string) => (id === 'quick' ? 'quickAssistant' : 'main'),
    onWindowDestroyedByType: (_type: string, listener: (event: { id: string }) => void) => destroyed.event(listener)
  })
  memory = new MemoryService()
  editors = new MemoryEditorService()
  MockApplicationUtils.setService('MemoryService', memory)
  MockApplicationUtils.setService('MemoryEditorService', editors)
  editors['onInit']()
})

afterEach(async () => {
  editors['onStop']()
  await memory['onStop']()
  destroyed.dispose()
  MockApplicationUtils.resetServices()
  vi.restoreAllMocks()
  await removeFixture(fixture)
})

describe('memory editor command boundary', () => {
  it('denies unmanaged and quick windows before creating memory files', async () => {
    await expect(memoryHandlers['memory.editor.open']({ kind: 'shared' }, { senderId: null })).rejects.toMatchObject({
      data: { reason: 'unavailable' }
    })
    await expect(memoryHandlers['memory.editor.open']({ kind: 'shared' }, { senderId: 'quick' })).rejects.toThrow()
    expect(await readdir(fixture)).toEqual([])
  })

  it('binds editor IDs and read receipts to their real window and reports stale saves', async () => {
    const a = await memoryHandlers['memory.editor.open']({ kind: 'shared' }, main)
    const b = await memoryHandlers['memory.editor.open']({ kind: 'shared' }, { senderId: 'second' })
    const read = await memoryHandlers['memory.file.read']({ editorId: a.editorId, path: 'MEMORY.md' }, main)
    await expect(
      memoryHandlers['memory.file.read']({ editorId: a.editorId, path: 'MEMORY.md' }, { senderId: 'second' })
    ).rejects.toThrow()
    await expect(
      memoryHandlers['memory.file.write'](
        { editorId: b.editorId, receipt: read.receipt, content: 'Stolen' },
        { senderId: 'second' }
      )
    ).rejects.toMatchObject({ data: { reason: 'invalid-receipt' } })
    const other = await memoryHandlers['memory.file.read'](
      { editorId: b.editorId, path: 'MEMORY.md' },
      { senderId: 'second' }
    )
    await memoryHandlers['memory.file.write'](
      { editorId: b.editorId, receipt: other.receipt, content: 'New content' },
      { senderId: 'second' }
    )
    await expect(
      memoryHandlers['memory.file.write']({ editorId: a.editorId, receipt: read.receipt, content: 'Stale' }, main)
    ).rejects.toMatchObject({ data: { reason: 'conflict' } })
    expect(await readFile(path.join(fixture, 'feature.memory.data', 'MEMORY.md'), 'utf8')).toBe('New content')
  })

  it('requires a matching clear preview and restores the confirmed operation', async () => {
    const { editorId } = await memoryHandlers['memory.editor.open']({ kind: 'shared' }, main)
    const read = await memoryHandlers['memory.file.read']({ editorId, path: 'MEMORY.md' }, main)
    await memoryHandlers['memory.file.write']({ editorId, receipt: read.receipt, content: 'Remember me' }, main)
    const preview = await memoryHandlers['memory.clear.preview']({ editorId }, main)
    const cleared = await memoryHandlers['memory.clear.confirm']({ editorId, token: preview.token }, main)
    expect(cleared.files).toMatchObject([{ path: 'MEMORY.md', outcome: 'applied' }])
    const recovery = await memoryHandlers['memory.recovery.preview']({ editorId }, main)
    await memoryHandlers['memory.recovery.confirm']({ editorId, token: recovery!.token }, main)
    expect((await memoryHandlers['memory.file.read']({ editorId, path: 'MEMORY.md' }, main)).content).toBe(
      'Remember me'
    )
  })

  it('expires editors when their window is destroyed even if that window ID is later reused', async () => {
    const { editorId } = await memoryHandlers['memory.editor.open']({ kind: 'shared' }, main)
    const read = await memoryHandlers['memory.file.read']({ editorId, path: 'MEMORY.md' }, main)
    windows.delete('main')
    destroyed.fire({ id: 'main' })
    windows.add('main')
    await expect(
      memoryHandlers['memory.file.write']({ editorId, receipt: read.receipt, content: 'Old window' }, main)
    ).rejects.toThrow()
    expect(await readFile(path.join(fixture, 'feature.memory.data', 'MEMORY.md'), 'utf8')).toBe('')
  })
})
