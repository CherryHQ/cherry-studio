import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'

vi.mock('@main/i18n', () => ({ t: (key: string) => key }))

import { fileStorage } from '../FileStorage'

const event = {} as Electron.IpcMainInvokeEvent
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1sAAAAASUVORK5CYII=',
  'base64'
)

describe('FileStorage temporary files', () => {
  let root: string
  let managedRoot: string
  let tempDir: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'cherry-file-storage-temp-'))
    managedRoot = path.join(root, 'Data', 'Files')
    tempDir = path.join(root, 'cache', 'temp')
    await Promise.all([mkdir(managedRoot, { recursive: true }), mkdir(tempDir, { recursive: true })])
    vi.spyOn(application, 'getPath').mockImplementation((key: string) => {
      if (key === 'app.temp') return tempDir
      if (key === 'feature.files.data') return managedRoot
      throw new Error(`Unexpected application.getPath(${key})`)
    })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
  })

  it.each([
    { name: 'capture.png', data: new Uint8Array(png), bytes: png },
    { name: 'clipboard.txt', data: 'Clipboard text\n你好', bytes: Buffer.from('Clipboard text\n你好') },
    {
      name: 'preview.html',
      data: '<!doctype html><html><body>预览</body></html>',
      bytes: Buffer.from('<!doctype html><html><body>预览</body></html>')
    }
  ])('writes $name after repeated cleanup of the already resolved directory', async ({ name, data, bytes }) => {
    const paths = new Set<string>()
    const initialPath = await fileStorage.createTempFile(event, name)
    await fileStorage.writeFile(event, initialPath, data)
    expect(await readFile(initialPath)).toEqual(bytes)
    paths.add(initialPath)

    for (let cycle = 0; cycle < 2; cycle++) {
      await rm(path.dirname(tempDir), { recursive: true })
      const filePath = await fileStorage.createTempFile(event, name)
      expect(path.dirname(filePath)).toBe(tempDir)
      await fileStorage.writeFile(event, filePath, data)
      expect(await readFile(filePath)).toEqual(bytes)
      expect((await stat(tempDir)).isDirectory()).toBe(true)
      paths.add(filePath)
    }

    expect(paths.size).toBe(3)
  })

  it('keeps absolute and traversal filenames inside the temporary directory', async () => {
    for (const name of [path.join(root, 'outside.html'), path.join('..', '..', 'outside.html')]) {
      const filePath = await fileStorage.createTempFile(event, name)
      expect(path.dirname(filePath)).toBe(tempDir)
      expect(path.basename(filePath)).toMatch(/^temp_file_.+_outside\.html$/)
      await fileStorage.writeFile(event, filePath, 'preview')
      expect(await readFile(filePath, 'utf8')).toBe('preview')
    }
    await expect(stat(path.join(root, 'outside.html'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a temporary directory inside managed storage before creating it', async () => {
    tempDir = path.join(managedRoot, 'missing-temp')

    await expect(fileStorage.createTempFile(event, 'capture.png')).rejects.toThrow(/overlaps FileManager-owned/)

    await expect(stat(tempDir)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(managedRoot)).toEqual([])
  })

  it('rejects a missing temporary child of a symlink into managed storage before creating it', async () => {
    const link = path.join(root, 'managed-link')
    await symlink(managedRoot, link, process.platform === 'win32' ? 'junction' : 'dir')
    tempDir = path.join(link, 'missing-temp')

    await expect(fileStorage.createTempFile(event, 'capture.png')).rejects.toThrow(/overlaps FileManager-owned/)

    await expect(stat(path.join(managedRoot, 'missing-temp'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(managedRoot)).toEqual([])
  })

  it('rejects a regular file at the temporary directory path without changing its bytes', async () => {
    await rm(tempDir, { recursive: true })
    const bytes = Buffer.from([0, 255, 128, 10])
    await writeFile(tempDir, bytes)

    await expect(fileStorage.createTempFile(event, 'capture.png')).rejects.toThrow()

    expect(await readFile(tempDir)).toEqual(bytes)
  })

  it('keeps generic writes from creating a missing parent directory', async () => {
    const parent = path.join(root, 'missing-export')

    await expect(fileStorage.writeFile(event, path.join(parent, 'note.txt'), 'note')).rejects.toMatchObject({
      code: 'ENOENT'
    })

    await expect(stat(parent)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
