import type * as NodeFs from 'node:fs'
import type * as NodeOs from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type * as PathStorage from '../../storage/pathStorage'

const copyFileIntoKnowledgeBaseAtMock = vi.hoisted(() =>
  vi.fn(async (_baseId: string, _externalPath: string, relativePath: string) => relativePath)
)

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

vi.mock('../../storage/pathStorage', async () => {
  const actual = await vi.importActual<typeof PathStorage>('../../storage/pathStorage')
  return {
    ...actual,
    copyFileIntoKnowledgeBaseAt: copyFileIntoKnowledgeBaseAtMock
  }
})

const { expandDirectoryOwnerToTree } = await import('../directory')
const realFs = await vi.importActual<typeof NodeFs>('node:fs')
const realOs = await vi.importActual<typeof NodeOs>('node:os')

function createTempRoot() {
  return realFs.mkdtempSync(path.join(realOs.tmpdir(), 'knowledge-directory-expand-'))
}

function createSignal() {
  return new AbortController().signal
}

describe('expandDirectoryOwnerToTree', () => {
  let tempRoot: string | undefined

  afterEach(() => {
    if (tempRoot) {
      realFs.rmSync(tempRoot, { recursive: true, force: true })
      tempRoot = undefined
    }
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
        error: null,
        createdAt: '2026-04-08T00:00:00.000Z',
        updatedAt: '2026-04-08T00:00:00.000Z'
      },
      'kb-1',
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
                  relativePath: 'dir-owner-1/agents/skills/skill.md'
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
        error: null,
        createdAt: '2026-04-08T00:00:00.000Z',
        updatedAt: '2026-04-08T00:00:00.000Z'
      },
      'kb-1',
      createSignal()
    )

    expect(JSON.stringify(nodes)).not.toContain(emptyDir)
    expect(nodes).toContainEqual(
      expect.objectContaining({
        type: 'file',
        data: expect.objectContaining({
          source: path.join(rootDir, 'readme.md'),
          relativePath: 'dir-owner-1/readme.md'
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
                  source: path.join(nestedDir, 'reference.md'),
                  relativePath: 'dir-owner-1/guides/api/reference.md'
                })
              })
            ]
          })
        ]
      })
    )
  })

  it('skips unsupported file extensions while expanding directory trees', async () => {
    tempRoot = createTempRoot()
    const rootDir = path.join(tempRoot, 'workspace')
    realFs.mkdirSync(rootDir, { recursive: true })
    realFs.writeFileSync(path.join(rootDir, 'readme.md'), '# readme')
    realFs.writeFileSync(path.join(rootDir, 'app.exe'), 'binary')
    // OpenDocument formats are app-wide "documents" but intentionally unsupported by the
    // knowledge base, so a rebuild/restore that walks a directory must skip them too.
    realFs.writeFileSync(path.join(rootDir, 'legacy.odt'), 'odt')
    realFs.writeFileSync(path.join(rootDir, 'deck.odp'), 'odp')
    realFs.writeFileSync(path.join(rootDir, 'sheet.ods'), 'ods')

    copyFileIntoKnowledgeBaseAtMock.mockClear()
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
        error: null,
        createdAt: '2026-04-08T00:00:00.000Z',
        updatedAt: '2026-04-08T00:00:00.000Z'
      },
      'kb-1',
      createSignal()
    )

    expect(nodes).toEqual([
      {
        type: 'file',
        data: {
          source: path.join(rootDir, 'readme.md'),
          relativePath: 'dir-owner-1/readme.md'
        }
      }
    ])
    expect(copyFileIntoKnowledgeBaseAtMock).toHaveBeenCalledTimes(1)
    expect(copyFileIntoKnowledgeBaseAtMock).toHaveBeenCalledWith(
      'kb-1',
      path.join(rootDir, 'readme.md'),
      'dir-owner-1/readme.md'
    )
  })

  it('gives same-basename files in different subdirectories distinct relative paths', async () => {
    tempRoot = createTempRoot()
    const rootDir = path.join(tempRoot, 'project')
    const dirA = path.join(rootDir, 'a')
    const dirB = path.join(rootDir, 'b')
    realFs.mkdirSync(dirA, { recursive: true })
    realFs.mkdirSync(dirB, { recursive: true })
    realFs.writeFileSync(path.join(dirA, 'notes.md'), '# a')
    realFs.writeFileSync(path.join(dirB, 'notes.md'), '# b')

    copyFileIntoKnowledgeBaseAtMock.mockClear()
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
        error: null,
        createdAt: '2026-04-08T00:00:00.000Z',
        updatedAt: '2026-04-08T00:00:00.000Z'
      },
      'kb-1',
      createSignal()
    )

    const relativePaths = JSON.stringify(nodes)
    expect(relativePaths).toContain('dir-owner-1/a/notes.md')
    expect(relativePaths).toContain('dir-owner-1/b/notes.md')
    // No collision: copy is invoked once per file with a unique target path.
    const copiedTargets = copyFileIntoKnowledgeBaseAtMock.mock.calls.map((call) => call[2])
    expect(new Set(copiedTargets).size).toBe(copiedTargets.length)
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
          error: null,
          createdAt: '2026-04-08T00:00:00.000Z',
          updatedAt: '2026-04-08T00:00:00.000Z'
        },
        'kb-1',
        controller.signal
      )
    ).rejects.toBe(abortError)
  })
})
