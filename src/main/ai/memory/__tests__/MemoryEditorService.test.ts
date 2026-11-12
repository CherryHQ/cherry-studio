import { mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { MockApplicationUtils } from '@test-mocks/main/application'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { BaseService, Emitter } from '@main/core/lifecycle'
import { memoryHandlers } from '@main/ipc/handlers/memory'

import { MemoryEditorService } from '../MemoryEditorService'
import { parseMemoryEntries } from '../memoryEntries'
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

  it('binds clear tokens to their real window', async () => {
    const a = await memoryHandlers['memory.editor.open']({ kind: 'shared' }, main)
    const second = { senderId: 'second' }
    const b = await memoryHandlers['memory.editor.open']({ kind: 'shared' }, second)
    await memoryHandlers['memory.clear.preview']({ editorId: a.editorId }, main)
    await writeFile(path.join(fixture, 'feature.memory.data', 'MEMORY.md'), 'Keep me')
    const preview = await memoryHandlers['memory.clear.preview']({ editorId: a.editorId }, main)
    await expect(memoryHandlers['memory.clear.preview']({ editorId: a.editorId }, second)).rejects.toThrow()
    await expect(
      memoryHandlers['memory.clear.confirm']({ editorId: b.editorId, token: preview.token }, second)
    ).rejects.toMatchObject({ data: { reason: 'invalid-receipt' } })
    expect(await readFile(path.join(fixture, 'feature.memory.data', 'MEMORY.md'), 'utf8')).toBe('Keep me')
  })

  it('clears through IPC and refuses recovery that would erase the unknown-source tombstone', async () => {
    const { editorId } = await memoryHandlers['memory.editor.open']({ kind: 'shared' }, main)
    await memoryHandlers['memory.clear.preview']({ editorId }, main)
    await writeFile(path.join(fixture, 'feature.memory.data', 'MEMORY.md'), 'Remember me')
    const preview = await memoryHandlers['memory.clear.preview']({ editorId }, main)
    const cleared = await memoryHandlers['memory.clear.confirm']({ editorId, token: preview.token }, main)
    expect(cleared.files).toMatchObject([{ path: 'MEMORY.md', outcome: 'applied' }])
    const file = path.join(fixture, 'feature.memory.data', 'MEMORY.md')
    const tombstone = await readFile(file, 'utf8')
    expect(tombstone).not.toContain('Remember me')
    expect(parseMemoryEntries(tombstone).filter((part) => typeof part !== 'string')).toEqual([
      expect.objectContaining({ status: 'forgotten', text: '', sources: [] })
    ])
    const recovery = await memoryHandlers['memory.recovery.preview']({ editorId }, main)
    await expect(
      memoryHandlers['memory.recovery.confirm']({ editorId, token: recovery!.token }, main)
    ).rejects.toMatchObject({ data: { reason: 'conflict' } })
    expect(await readFile(file, 'utf8')).toBe(tombstone)
  })

  it('expires editors when their window is destroyed even if that window ID is later reused', async () => {
    const { editorId } = await memoryHandlers['memory.editor.open']({ kind: 'shared' }, main)
    const preview = await memoryHandlers['memory.clear.preview']({ editorId }, main)
    windows.delete('main')
    destroyed.fire({ id: 'main' })
    windows.add('main')
    await expect(memoryHandlers['memory.clear.confirm']({ editorId, token: preview.token }, main)).rejects.toThrow()
    expect(await readFile(path.join(fixture, 'feature.memory.data', 'MEMORY.md'), 'utf8')).toBe('')
  })
})
