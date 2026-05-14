import type * as NodeFs from 'node:fs'
import type * as NodeOs from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ensureKnowledgeExternalFileEntryMock = vi.hoisted(() => vi.fn())

vi.mock('../file', () => ({
  ensureKnowledgeExternalFileEntry: ensureKnowledgeExternalFileEntryMock
}))

const { expandDirectoryOwnerToTree } = await import('../directory')
const realFs = await vi.importActual<typeof NodeFs>('node:fs')
const realOs = await vi.importActual<typeof NodeOs>('node:os')

function createTempRoot() {
  return realFs.mkdtempSync(path.join(realOs.tmpdir(), 'knowledge-directory-expand-'))
}

function createSignal() {
  return new AbortController().signal
}

function createExternalEntry(filePath: string) {
  const ext = path.extname(filePath).replace(/^\./, '') || null
  return {
    id: `019606a0-0000-7000-8000-${Buffer.from(filePath).toString('hex').slice(-12).padStart(12, '0')}`,
    origin: 'external' as const,
    name: path.basename(filePath, path.extname(filePath)),
    ext,
    externalPath: filePath,
    createdAt: 1775114958369,
    updatedAt: 1775114958369
  }
}

describe('expandDirectoryOwnerToTree', () => {
  let tempRoot: string | undefined

  beforeEach(() => {
    ensureKnowledgeExternalFileEntryMock.mockImplementation(async (filePath: string) => createExternalEntry(filePath))
  })

  afterEach(() => {
    if (tempRoot) {
      realFs.rmSync(tempRoot, { recursive: true, force: true })
      tempRoot = undefined
    }
    ensureKnowledgeExternalFileEntryMock.mockReset()
  })

  it('expands a directory owner into a tree while preserving hierarchy', async () => {
    tempRoot = createTempRoot()
    const rootDir = path.join(tempRoot, 'anna')
    const nestedDir = path.join(rootDir, 'agents', 'skills')
    realFs.mkdirSync(nestedDir, { recursive: true })
    realFs.writeFileSync(path.join(rootDir, '.dockerignore'), 'node_modules')
    realFs.writeFileSync(path.join(nestedDir, 'skill.md'), '# skill')

    const nodes = await expandDirectoryOwnerToTree(
      {
        id: 'dir-owner-1',
        baseId: 'kb-1',
        groupId: null,
        type: 'directory',
        data: {
          source: rootDir,
          path: rootDir
        },
        status: 'idle',
        phase: null,
        error: null,
        createdAt: '2026-04-08T00:00:00.000Z',
        updatedAt: '2026-04-08T00:00:00.000Z'
      },
      createSignal()
    )

    expect(nodes).toEqual([
      {
        type: 'directory',
        data: { source: path.join(rootDir, 'agents'), path: path.join(rootDir, 'agents') },
        children: [
          {
            type: 'directory',
            data: { source: nestedDir, path: nestedDir },
            children: [
              {
                type: 'file',
                data: {
                  source: path.join(nestedDir, 'skill.md'),
                  fileEntryId: expect.any(String)
                }
              }
            ]
          }
        ]
      }
    ])
  })

  it('skips empty nested directories while preserving non-empty directory hierarchy', async () => {
    tempRoot = createTempRoot()
    const rootDir = path.join(tempRoot, 'workspace')
    const emptyDir = path.join(rootDir, 'empty')
    const nestedDir = path.join(rootDir, 'guides', 'api')
    realFs.mkdirSync(emptyDir, { recursive: true })
    realFs.mkdirSync(nestedDir, { recursive: true })
    realFs.writeFileSync(path.join(rootDir, 'readme.md'), '# readme')
    realFs.writeFileSync(path.join(nestedDir, 'reference.md'), '# reference')

    const nodes = await expandDirectoryOwnerToTree(
      {
        id: 'dir-owner-1',
        baseId: 'kb-1',
        groupId: null,
        type: 'directory',
        data: {
          source: rootDir,
          path: rootDir
        },
        status: 'idle',
        phase: null,
        error: null,
        createdAt: '2026-04-08T00:00:00.000Z',
        updatedAt: '2026-04-08T00:00:00.000Z'
      },
      createSignal()
    )

    expect(JSON.stringify(nodes)).not.toContain(emptyDir)
    expect(nodes).toContainEqual(
      expect.objectContaining({
        type: 'file',
        data: expect.objectContaining({
          source: path.join(rootDir, 'readme.md')
        })
      })
    )
    expect(nodes).toContainEqual(
      expect.objectContaining({
        type: 'directory',
        data: expect.objectContaining({ path: path.join(rootDir, 'guides') }),
        children: [
          expect.objectContaining({
            type: 'directory',
            data: expect.objectContaining({ path: nestedDir }),
            children: [
              expect.objectContaining({
                type: 'file',
                data: expect.objectContaining({
                  source: path.join(nestedDir, 'reference.md')
                })
              })
            ]
          })
        ]
      })
    )
  })

  it('skips unsupported files before creating external file entries', async () => {
    tempRoot = createTempRoot()
    realFs.writeFileSync(path.join(tempRoot, 'photo.png'), 'image')
    realFs.writeFileSync(path.join(tempRoot, 'song.mp3'), 'audio')

    const nodes = await expandDirectoryOwnerToTree(
      {
        id: 'dir-owner-1',
        baseId: 'kb-1',
        groupId: null,
        type: 'directory',
        data: {
          source: tempRoot,
          path: tempRoot
        },
        status: 'idle',
        phase: null,
        error: null,
        createdAt: '2026-04-08T00:00:00.000Z',
        updatedAt: '2026-04-08T00:00:00.000Z'
      },
      createSignal()
    )

    expect(nodes).toEqual([])
    expect(ensureKnowledgeExternalFileEntryMock).not.toHaveBeenCalled()
  })

  it('stops before reading when the runtime signal is already aborted', async () => {
    tempRoot = createTempRoot()
    const controller = new AbortController()
    const abortError = new Error('interrupted')
    controller.abort(abortError)

    await expect(
      expandDirectoryOwnerToTree(
        {
          id: 'dir-owner-1',
          baseId: 'kb-1',
          groupId: null,
          type: 'directory',
          data: {
            source: tempRoot,
            path: tempRoot
          },
          status: 'idle',
          phase: null,
          error: null,
          createdAt: '2026-04-08T00:00:00.000Z',
          updatedAt: '2026-04-08T00:00:00.000Z'
        },
        controller.signal
      )
    ).rejects.toBe(abortError)
  })
})
