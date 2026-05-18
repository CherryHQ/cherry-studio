import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { application } from '@application'
import type { FileEntry, FileEntryId } from '@shared/data/types/file'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { toFileInfo } = await import('../toFileInfo')

describe('toFileInfo', () => {
  let tmp: string
  let internalRoot: string

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-tofileinfo-'))
    internalRoot = path.join(tmp, 'files-internal')
    await mkdir(internalRoot, { recursive: true })
    vi.mocked(application.getPath).mockImplementation((key: string, filename?: string) => {
      if (key === 'feature.files.data') {
        return filename ? path.join(internalRoot, filename) : internalRoot
      }
      return filename ? `/mock/${key}/${filename}` : `/mock/${key}`
    })
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('returns FileInfo for an external entry', async () => {
    const file = path.join(tmp, 'note.txt')
    await writeFile(file, 'hello world', 'utf-8')

    const entry = {
      id: '019606a0-0000-7000-8000-00000000ee01' as FileEntryId,
      origin: 'external' as const,
      name: 'note',
      ext: 'txt',
      size: null,
      externalPath: file,
      trashedAt: null,
      createdAt: 1000,
      updatedAt: 1000
    } as unknown as FileEntry

    const info = await toFileInfo(entry)
    expect(info.path).toBe(file)
    expect(info.name).toBe('note')
    expect(info.ext).toBe('txt')
    expect(info.size).toBe('hello world'.length)
    expect(info.mime).toBe('text/plain')
    expect(info.type).toBe('text')
    expect(info.modifiedAt).toBeGreaterThan(0)
  })

  it('returns FileInfo for an internal entry resolved into feature.files.data', async () => {
    const id = '019606a0-0000-7000-8000-00000000ee02' as FileEntryId
    const physicalPath = path.join(internalRoot, `${id}.png`)
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    await writeFile(physicalPath, bytes)

    const entry = {
      id,
      origin: 'internal' as const,
      name: 'pic',
      ext: 'png',
      size: bytes.length,
      externalPath: null,
      trashedAt: null,
      createdAt: 1000,
      updatedAt: 1000
    } as unknown as FileEntry

    const info = await toFileInfo(entry)
    expect(info.path).toBe(physicalPath)
    expect(info.size).toBe(bytes.length)
    expect(info.mime).toBe('image/png')
    expect(info.type).toBe('image')
  })

  it('propagates ENOENT for missing files', async () => {
    const entry = {
      id: '019606a0-0000-7000-8000-00000000ee03' as FileEntryId,
      origin: 'external' as const,
      name: 'gone',
      ext: 'txt',
      size: null,
      externalPath: path.join(tmp, 'gone.txt'),
      trashedAt: null,
      createdAt: 1000,
      updatedAt: 1000
    } as unknown as FileEntry

    await expect(toFileInfo(entry)).rejects.toThrow(/ENOENT/)
  })

  it('uses null ext when entry has no extension', async () => {
    const file = path.join(tmp, 'Dockerfile')
    await writeFile(file, 'FROM node:22')

    const entry = {
      id: '019606a0-0000-7000-8000-00000000ee04' as FileEntryId,
      origin: 'external' as const,
      name: 'Dockerfile',
      ext: null,
      size: null,
      externalPath: file,
      trashedAt: null,
      createdAt: 1000,
      updatedAt: 1000
    } as unknown as FileEntry

    const info = await toFileInfo(entry)
    expect(info.ext).toBeNull()
    expect(info.type).toBe('other')
    expect(info.mime).toBe('application/octet-stream')
  })
})
