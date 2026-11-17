import fsp from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { measureToolInstalledSize } from '../toolInstalledSize'

describe('installed size filesystem measurement', () => {
  let root: string
  let measure: typeof measureToolInstalledSize

  beforeEach(async () => {
    const modulePath = '../toolInstalledSize'
    measure = (await import(modulePath)).measureToolInstalledSize
    root = await fsp.realpath(await fsp.mkdtemp(path.join(tmpdir(), 'installed-size-')))
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    if (root) await fsp.rm(root, { recursive: true, force: true })
  })

  it('F1 sums 3 + 5 + 7 real bytes without following external or cyclic links', async () => {
    const installation = path.join(root, 'installation')
    await fsp.mkdir(path.join(installation, 'one', 'two'), { recursive: true })
    await fsp.writeFile(path.join(installation, 'a'), '123')
    await fsp.writeFile(path.join(installation, 'one', 'b'), '12345')
    await fsp.writeFile(path.join(installation, 'one', 'two', 'c'), '1234567')
    await fsp.writeFile(path.join(root, 'large'), Buffer.alloc(100_000))
    await fsp.symlink(path.join(root, 'large'), path.join(installation, 'external-file'))
    await fsp.symlink(root, path.join(installation, 'external-directory'), 'dir')
    await fsp.symlink(installation, path.join(installation, 'one', 'cycle'), 'dir')

    expect(await measure(installation, 'directory')).toEqual({ sizeBytes: 15 })
  })

  it('F2 distinguishes an empty real directory from absent and symlink roots', async () => {
    expect(await measure(root, 'directory')).toEqual({ sizeBytes: 0 })
    expect((await measure(path.join(root, 'missing'), 'directory')).sizeBytes).toBeNull()
    await fsp.symlink(root, path.join(root, 'alias'), 'dir')
    expect((await measure(path.join(root, 'alias'), 'directory')).sizeBytes).toBeNull()
    await fsp.writeFile(path.join(root, 'file'), '123')
    expect((await measure(path.join(root, 'file'), 'directory')).sizeBytes).toBeNull()
    expect((await measure(root, 'file')).sizeBytes).toBeNull()
  })

  it.each(['ENOENT', 'EACCES', 'EPERM'])('F2 discards partial bytes after child %s', async (code) => {
    await fsp.writeFile(path.join(root, 'first'), '123')
    await fsp.writeFile(path.join(root, 'second'), '12345')
    const lstat = fsp.lstat.bind(fsp)
    let children = 0
    vi.spyOn(fsp, 'lstat').mockImplementation(async (...args) => {
      if (String(args[0]) !== root && ++children === 2) throw Object.assign(new Error('child failed'), { code })
      return lstat(...args)
    })
    expect(await measure(root, 'directory')).toEqual({ sizeBytes: null, reason: code })
    expect(children).toBe(2)
  })

  it('F3 stops dispatching after the node budget and closes the directory', async () => {
    await fsp.writeFile(path.join(root, 'a'), '123')
    await fsp.writeFile(path.join(root, 'b'), '12345')
    const opendir = fsp.opendir.bind(fsp)
    const close = vi.fn()
    vi.spyOn(fsp, 'opendir').mockImplementation(async (...args) => {
      const handle = await opendir(...args)
      const originalClose = handle.close.bind(handle)
      vi.spyOn(handle, 'close').mockImplementation(async () => {
        close()
        await originalClose()
      })
      return handle
    })
    const lstat = vi.spyOn(fsp, 'lstat')
    expect(await measure(root, 'directory', { maxNodes: 2 })).toEqual({ sizeBytes: null, reason: 'node_budget' })
    expect(lstat).toHaveBeenCalledTimes(2)
    expect(close).toHaveBeenCalledOnce()
  })

  it('F3 checks elapsed time after awaited reads before dispatching another I/O', async () => {
    await fsp.writeFile(path.join(root, 'a'), '123')
    let now = 0
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const opendir = fsp.opendir.bind(fsp)
    const close = vi.fn()
    const read = vi.fn()
    vi.spyOn(fsp, 'opendir').mockImplementation(async (...args) => {
      const handle = await opendir(...args)
      const originalRead = handle.read.bind(handle)
      const originalClose = handle.close.bind(handle)
      vi.spyOn(handle, 'read').mockImplementation(async () => {
        read()
        const entry = await originalRead()
        now = 5
        return entry
      })
      vi.spyOn(handle, 'close').mockImplementation(async () => {
        close()
        await originalClose()
      })
      return handle
    })
    const lstat = vi.spyOn(fsp, 'lstat')
    expect(await measure(root, 'directory', { budgetMs: 5 })).toEqual({ sizeBytes: null, reason: 'time_budget' })
    expect(read).toHaveBeenCalledOnce()
    expect(lstat).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })
})
