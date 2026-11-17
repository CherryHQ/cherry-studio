import { mkdir, mkdtemp, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'
import type { FileObservationResource } from '@shared/ipc/schemas/fileObservation'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import { FileObservationService } from '../observation/FileObservationService'
import * as watcherModule from '../watcher'
import type { WatcherListener } from '../watcher'

let root: string
let service: FileObservationService
const owner = (id: number) => ({
  windowId: `window-${id}`,
  webContents: { id, isDestroyed: () => false, send: vi.fn() }
})

beforeEach(async () => {
  BaseService.resetInstances()
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'cherry-observe-')))
  service = new FileObservationService()
  await service._doInit()
})

afterEach(async () => {
  await service._doStop()
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})

function events(sender: ReturnType<typeof owner>): FileObservationResource[] {
  return sender.webContents.send.mock.calls.map((call) => call[2])
}

it('observes same-length writes, atomic replacement and delete/recreate without a directory tree', async () => {
  const target = AbsoluteFilePathSchema.parse(path.join(root, '.hidden.txt'))
  await writeFile(target, 'one')
  const sender = owner(1)
  const opened = await service.open(sender, target)
  expect(service.activateSubscription(opened.subscriptionId, opened.revision, 2)).toBe(false)
  expect(service.activateSubscription(opened.subscriptionId, opened.revision, 1)).toBe(true)
  for (const mutate of [
    async () => {
      await writeFile(target, 'two')
    },
    async () => {
      await writeFile(`${target}.swap`, 'new')
      await rename(`${target}.swap`, target)
    },
    async () => {
      await rm(target)
    },
    async () => {
      await writeFile(target, 'back')
    }
  ]) {
    const count = events(sender).length
    await mutate()
    await vi.waitFor(() => expect(events(sender).length).toBeGreaterThan(count), { timeout: 5000 })
    expect(events(sender).at(-1)?.coverage).toBe('live')
  }
})

it('shares a native scope while consumers are independent and closes it after the final release', async () => {
  const target = AbsoluteFilePathSchema.parse(path.join(root, 'file.txt'))
  await writeFile(target, 'before')
  const create = vi.spyOn(watcherModule, 'createDirectoryWatcher')
  const first = owner(1)
  const second = owner(2)
  const a = await service.open(first, target)
  const b = await service.open(second, target)
  const watcher = create.mock.results[0].value
  const close = vi.spyOn(watcher, 'close')
  expect(create).toHaveBeenCalledTimes(1)
  service.activateSubscription(b.subscriptionId, b.revision, 2)
  service.close(a.subscriptionId, 2)
  expect(service.activateSubscription(a.subscriptionId, a.revision, 1)).toBe(true)
  service.close(a.subscriptionId, 1)
  await writeFile(target, 'after')
  await vi.waitFor(() => expect(events(second).length).toBeGreaterThan(0), { timeout: 5000 })
  expect(close).not.toHaveBeenCalled()
  service.close(b.subscriptionId, 2)
  await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1))
})

it('replays an invalidation between open and activate and reports system-resume coverage loss', async () => {
  const target = AbsoluteFilePathSchema.parse(path.join(root, 'file.txt'))
  await writeFile(target, 'before')
  const sender = owner(1)
  const opened = await service.open(sender, target)
  await writeFile(target, 'after')
  await vi.waitFor(() => {
    const resume = vi.mocked(application.get('PowerService').onResume).mock.calls.at(-1)?.[0]
    expect(resume).toBeDefined()
  })
  const resume = vi.mocked(application.get('PowerService').onResume).mock.calls.at(-1)?.[0]
  resume?.()
  expect(events(sender)).toEqual([])
  expect(service.activateSubscription(opened.subscriptionId, opened.revision, 1)).toBe(true)
  expect(events(sender).at(-1)).toMatchObject({ subscriptionId: opened.subscriptionId, coverage: 'stale' })
  expect(events(sender).at(-1)?.revision).toBeGreaterThan(opened.revision)
})

it('starts from a missing parent and detects later directory and file creation', async () => {
  const target = AbsoluteFilePathSchema.parse(path.join(root, 'nested', 'file.txt'))
  const sender = owner(1)
  const opened = await service.open(sender, target)
  service.activateSubscription(opened.subscriptionId, opened.revision, 1)
  await mkdir(path.dirname(target))
  await writeFile(target, 'created')
  await vi.waitFor(() => expect(events(sender).length).toBeGreaterThan(0), { timeout: 5000 })
})

it('observes a symlink target and invalidates the binding when the alias is retargeted', async () => {
  const first = path.join(root, 'first.txt')
  const second = path.join(root, 'second.txt')
  const alias = AbsoluteFilePathSchema.parse(path.join(root, 'alias.txt'))
  await writeFile(first, 'before')
  await writeFile(second, 'second')
  await symlink(first, alias)
  const sender = owner(1)
  const opened = await service.open(sender, alias)
  service.activateSubscription(opened.subscriptionId, opened.revision, 1)
  await writeFile(first, 'after')
  await vi.waitFor(() => expect(events(sender).length).toBeGreaterThan(0), { timeout: 5000 })
  const count = events(sender).length
  await symlink(second, `${alias}.swap`)
  await rename(`${alias}.swap`, alias)
  await vi.waitFor(
    () =>
      expect(
        events(sender)
          .slice(count)
          .some((event) => event.coverage === 'stale')
      ).toBe(true),
    { timeout: 5000 }
  )
})

it('reports lost coverage before a failed watcher is released', async () => {
  const listeners = new Set<WatcherListener>()
  const create = watcherModule.createDirectoryWatcher
  vi.spyOn(watcherModule, 'createDirectoryWatcher').mockImplementation((...args) => {
    const watcher = create(...args)
    const subscribe = watcher.onEvent.bind(watcher)
    watcher.onEvent = (listener) => {
      listeners.add(listener)
      return subscribe(listener)
    }
    return watcher
  })
  const target = AbsoluteFilePathSchema.parse(path.join(root, 'file.txt'))
  await writeFile(target, 'before')
  const sender = owner(1)
  const opened = await service.open(sender, target)
  service.activateSubscription(opened.subscriptionId, opened.revision, 1)
  for (const listener of listeners) listener({ kind: 'error', error: new Error('Watch coverage lost') })
  expect(events(sender).at(-1)?.coverage).toBe('unavailable')
})
