import type * as NodeFs from 'node:fs'
import type * as NodeOs from 'node:os'
import type * as NodePath from 'node:path'
import path from 'node:path'

import type { KnowledgeItem } from '@shared/data/types/knowledge'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type * as PathStorage from '../../../pathStorage'

const copyFileIntoKnowledgeBaseAtMock = vi.hoisted(() =>
  vi.fn(async (_baseId: string, _externalPath: string, relativePath: string) => relativePath)
)

vi.mock('node:path', async () => {
  const actual = await vi.importActual<typeof NodePath>('node:path')
  const mocked = {
    ...actual,
    resolve: vi.fn((...paths: string[]) => actual.resolve(...paths)),
    basename: vi.fn((filePath: string, suffix?: string) => actual.basename(filePath, suffix)),
    parse: vi.fn((filePath: string) => actual.parse(filePath))
  }
  return { ...mocked, default: mocked }
})

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

vi.mock('../../../pathStorage', async () => {
  const actual = await vi.importActual<typeof PathStorage>('../../../pathStorage')
  return {
    ...actual,
    copyFileIntoKnowledgeBaseAt: copyFileIntoKnowledgeBaseAtMock
  }
})

const { chooseDirectoryPathPrefix, expandDirectoryOwnerToTree } = await import('../directory')
const realFs = await vi.importActual<typeof NodeFs>('node:fs')
const realOs = await vi.importActual<typeof NodeOs>('node:os')
const realPath = await vi.importActual<typeof NodePath>('node:path')

afterEach(() => {
  vi.mocked(path.resolve).mockImplementation(realPath.resolve)
  vi.mocked(path.basename).mockImplementation(realPath.basename)
  vi.mocked(path.parse).mockImplementation(realPath.parse)
})

function createTempRoot() {
  return realFs.mkdtempSync(path.join(realOs.tmpdir(), 'knowledge-directory-expand-'))
}

function createSignal() {
  return new AbortController().signal
}

function createDirectoryOwner(source: string): KnowledgeItem {
  return {
    id: 'dir-owner-1',
    baseId: 'kb-1',
    groupId: null,
    type: 'directory',
    data: { source },
    status: 'processing',
    error: null,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

const ignoreCopyProgress = vi.fn()

describe('chooseDirectoryPathPrefix', () => {
  it('uses the directory basename when that top-level name is free', () => {
    expect(chooseDirectoryPathPrefix(createDirectoryOwner('/some/path/anna'), new Set())).toBe('anna')
  })

  it('dedupes with a `_N` suffix when the top-level name is already taken', () => {
    expect(chooseDirectoryPathPrefix(createDirectoryOwner('/some/path/project'), new Set(['project']))).toBe(
      'project_1'
    )
  })

  it('dedupes after the whole basename, not before a fake extension', () => {
    // A folder literally named `report.v2`: the trailing `.v2` is part of the name,
    // not a file extension, so the suffix must land after it (`report.v2_1`).
    expect(chooseDirectoryPathPrefix(createDirectoryOwner('/some/path/report.v2'), new Set(['report.v2']))).toBe(
      'report.v2_1'
    )
  })

  it('uses a stable non-empty prefix for the POSIX filesystem root', () => {
    vi.mocked(path.resolve).mockImplementation(realPath.posix.resolve)
    vi.mocked(path.basename).mockImplementation(realPath.posix.basename)
    vi.mocked(path.parse).mockImplementation(realPath.posix.parse)

    expect(chooseDirectoryPathPrefix(createDirectoryOwner('/'), new Set())).toBe('root')
  })

  it('uses the drive name as the prefix for a Windows drive root', () => {
    vi.mocked(path.resolve).mockImplementation(realPath.win32.resolve)
    vi.mocked(path.basename).mockImplementation(realPath.win32.basename)
    vi.mocked(path.parse).mockImplementation(realPath.win32.parse)

    expect(chooseDirectoryPathPrefix(createDirectoryOwner('C:\\'), new Set())).toBe('C')
  })

  it('sanitizes a Windows-illegal character the local filesystem accepts', () => {
    // Legal here is not enough: the prefix is the first segment of every child's stored path,
    // and a backup made here has to restore on Windows. Matches what migration produces for the
    // same folder, so a container reindex no longer moves it (`KnowledgeMappings.test.ts`).
    vi.mocked(path.resolve).mockImplementation(realPath.posix.resolve)
    vi.mocked(path.basename).mockImplementation(realPath.posix.basename)
    vi.mocked(path.parse).mockImplementation(realPath.posix.parse)

    expect(chooseDirectoryPathPrefix(createDirectoryOwner('/some/path/a<b'), new Set())).toBe('a_b')
  })

  it('dedupes against a reserved namespace differing only in case', () => {
    // `reservedTopLevelNames` holds folded keys, so `Docs` and `docs` are one namespace —
    // claiming the second would bury the first once the base lands on APFS or NTFS.
    vi.mocked(path.resolve).mockImplementation(realPath.posix.resolve)
    vi.mocked(path.basename).mockImplementation(realPath.posix.basename)
    vi.mocked(path.parse).mockImplementation(realPath.posix.parse)

    expect(chooseDirectoryPathPrefix(createDirectoryOwner('/some/path/Docs'), new Set(['docs']))).toBe('Docs_1')
  })

  it('rejects the reserved .cherry prefix before it can be persisted', () => {
    expect(() => chooseDirectoryPathPrefix(createDirectoryOwner('/some/path/.cherry'), new Set())).toThrow(
      'Knowledge relative path is reserved: .cherry'
    )
  })

  it('rejects a non-directory owner', () => {
    const fileOwner = { ...createDirectoryOwner('/some/path/x'), type: 'file' } as KnowledgeItem
    expect(() => chooseDirectoryPathPrefix(fileOwner, new Set())).toThrow("must be type 'directory'")
  })
})

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

    const owner = createDirectoryOwner(rootDir)
    const pathPrefix = chooseDirectoryPathPrefix(owner, new Set())
    const children = await expandDirectoryOwnerToTree(owner, 'kb-1', pathPrefix, createSignal(), ignoreCopyProgress)

    expect(pathPrefix).toBe('anna')
    expect(children).toEqual([
      {
        type: 'directory',
        data: { source: path.join(rootDir, 'agents') },
        children: [
          {
            type: 'directory',
            data: { source: nestedDir },
            children: [
              {
                type: 'file',
                data: {
                  source: path.join(nestedDir, 'skill.md'),
                  relativePath: 'anna/agents/skills/skill.md'
                }
              }
            ]
          }
        ]
      }
    ])
  })

  it('sanitizes every stored segment while leaving the on-disk source untouched', async () => {
    tempRoot = createTempRoot()
    const rootDir = path.join(tempRoot, 'a<b')
    const nestedDir = path.join(rootDir, 'CON')
    realFs.mkdirSync(nestedDir, { recursive: true })
    const sourceFile = path.join(nestedDir, 'x|y.md')
    realFs.writeFileSync(sourceFile, '# x')

    const owner = createDirectoryOwner(rootDir)
    const children = await expandDirectoryOwnerToTree(
      owner,
      'kb-1',
      chooseDirectoryPathPrefix(owner, new Set()),
      createSignal(),
      ignoreCopyProgress
    )

    // `source` still points at the real file — only the `raw/` slot is renamed, so the
    // original is still reachable for reindex.
    expect(children).toContainEqual(
      expect.objectContaining({
        type: 'directory',
        children: [
          expect.objectContaining({
            type: 'file',
            data: { source: sourceFile, relativePath: 'a_b/_/x_y.md' }
          })
        ]
      })
    )
  })

  it('keeps both files when sanitizing maps two scanned names onto one slot', async () => {
    // Not reachable through a case-only pair (`a.md`/`A.md`): a case-insensitive dev machine
    // cannot create both, so the collision is provoked the platform-independent way. The copy
    // overwrites, so before dedup the second file simply replaced the first.
    tempRoot = createTempRoot()
    const rootDir = path.join(tempRoot, 'notes')
    realFs.mkdirSync(rootDir, { recursive: true })
    realFs.writeFileSync(path.join(rootDir, 'a<b.md'), '# first')
    realFs.writeFileSync(path.join(rootDir, 'a>b.md'), '# second')

    const owner = createDirectoryOwner(rootDir)
    const children = await expandDirectoryOwnerToTree(
      owner,
      'kb-1',
      chooseDirectoryPathPrefix(owner, new Set()),
      createSignal(),
      ignoreCopyProgress
    )

    const stored = children.map((child) => (child.type === 'file' ? child.data.relativePath : null))
    expect(stored).toHaveLength(2)
    expect(new Set(stored)).toEqual(new Set(['notes/a_b.md', 'notes/a_b_1.md']))
  })

  it('keeps a folder and a file apart when sanitizing gives them the same name', async () => {
    // They share one namespace on disk: whichever lands second would either write a file
    // over a directory or mkdir over a file, aborting the whole import.
    tempRoot = createTempRoot()
    const rootDir = path.join(tempRoot, 'notes')
    realFs.mkdirSync(path.join(rootDir, 'a<b.md'), { recursive: true })
    realFs.writeFileSync(path.join(rootDir, 'a<b.md', 'inner.md'), '# inner')
    realFs.writeFileSync(path.join(rootDir, 'a>b.md'), '# leaf')

    const owner = createDirectoryOwner(rootDir)
    const children = await expandDirectoryOwnerToTree(
      owner,
      'kb-1',
      chooseDirectoryPathPrefix(owner, new Set()),
      createSignal(),
      ignoreCopyProgress
    )

    const stored = JSON.stringify(children)
    expect(stored).toContain('notes/a_b.md/inner.md')
    expect(stored).toContain('notes/a_b_1.md')
  })

  it('keeps a filename that contains a backslash as one segment on POSIX', async () => {
    // The scan reports the entry name verbatim instead of a precomputed relative path, so
    // there is no `\` → `/` fold left to invent a directory level here (#17429).
    tempRoot = createTempRoot()
    const rootDir = path.join(tempRoot, 'notes')
    realFs.mkdirSync(rootDir, { recursive: true })
    realFs.writeFileSync(path.join(rootDir, 'a\\b.md'), '# one file')

    const owner = createDirectoryOwner(rootDir)
    const children = await expandDirectoryOwnerToTree(
      owner,
      'kb-1',
      chooseDirectoryPathPrefix(owner, new Set()),
      createSignal(),
      ignoreCopyProgress
    )

    expect(children).toEqual([
      expect.objectContaining({ type: 'file', data: expect.objectContaining({ relativePath: 'notes/a_b.md' }) })
    ])
  })

  it('treats two spellings of the same Unicode name as one slot', async () => {
    // ext4 keeps NFC and NFD apart; macOS `readdir` hands back NFD for what Linux wrote as
    // NFC. Either way they are one file once the base is restored, so both must be stored.
    tempRoot = createTempRoot()
    const rootDir = path.join(tempRoot, 'notes')
    realFs.mkdirSync(rootDir, { recursive: true })
    realFs.writeFileSync(path.join(rootDir, `${'café'.normalize('NFC')}.md`), '# nfc')
    const nfdName = `${'café'.normalize('NFD')}.md`
    if (!realFs.existsSync(path.join(rootDir, nfdName))) {
      realFs.writeFileSync(path.join(rootDir, nfdName), '# nfd')
    }

    const owner = createDirectoryOwner(rootDir)
    const children = await expandDirectoryOwnerToTree(
      owner,
      'kb-1',
      chooseDirectoryPathPrefix(owner, new Set()),
      createSignal(),
      ignoreCopyProgress
    )

    const stored = children.map((child) => (child.type === 'file' ? child.data.relativePath : null))
    // One file on a normalization-insensitive volume, two on ext4 — and where there are two,
    // the second must not have claimed the first one's slot.
    expect(new Set(stored).size).toBe(stored.length)
    if (stored.length === 2) {
      expect(stored.some((value) => value?.endsWith('_1.md'))).toBe(true)
    }
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

    const owner = createDirectoryOwner(rootDir)
    const children = await expandDirectoryOwnerToTree(
      owner,
      'kb-1',
      chooseDirectoryPathPrefix(owner, new Set()),
      createSignal(),
      ignoreCopyProgress
    )

    expect(JSON.stringify(children)).not.toContain(emptyDir)
    expect(children).toContainEqual(
      expect.objectContaining({
        type: 'file',
        data: expect.objectContaining({
          source: path.join(rootDir, 'readme.md'),
          relativePath: 'workspace/readme.md'
        })
      })
    )
    expect(children).toContainEqual(
      expect.objectContaining({
        type: 'directory',
        data: expect.objectContaining({ source: path.join(rootDir, 'guides') }),
        children: [
          expect.objectContaining({
            type: 'directory',
            data: expect.objectContaining({ source: nestedDir }),
            children: [
              expect.objectContaining({
                type: 'file',
                data: expect.objectContaining({
                  source: path.join(nestedDir, 'reference.md'),
                  relativePath: 'workspace/guides/api/reference.md'
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
    const owner = createDirectoryOwner(rootDir)
    const children = await expandDirectoryOwnerToTree(
      owner,
      'kb-1',
      chooseDirectoryPathPrefix(owner, new Set()),
      createSignal(),
      ignoreCopyProgress
    )

    expect(children).toEqual([
      {
        type: 'file',
        data: {
          source: path.join(rootDir, 'readme.md'),
          relativePath: 'workspace/readme.md'
        }
      }
    ])
    expect(copyFileIntoKnowledgeBaseAtMock).toHaveBeenCalledTimes(1)
    // The expansion copy threads the abort signal (so a hung file can be interrupted)
    // and sets overwrite so a retry re-copies over its own orphans from a prior attempt.
    expect(copyFileIntoKnowledgeBaseAtMock).toHaveBeenCalledWith(
      'kb-1',
      path.join(rootDir, 'readme.md'),
      'workspace/readme.md',
      { signal: expect.any(AbortSignal), overwrite: true }
    )
  })

  it('reports copied files against the supported-file total', async () => {
    tempRoot = createTempRoot()
    const rootDir = path.join(tempRoot, 'workspace')
    const nestedDir = path.join(rootDir, 'guides')
    realFs.mkdirSync(nestedDir, { recursive: true })
    realFs.writeFileSync(path.join(rootDir, 'readme.md'), '# readme')
    realFs.writeFileSync(path.join(nestedDir, 'guide.txt'), 'guide')
    realFs.writeFileSync(path.join(rootDir, 'app.exe'), 'binary')
    const onCopyProgress = vi.fn()
    const owner = createDirectoryOwner(rootDir)
    const pathPrefix = chooseDirectoryPathPrefix(owner, new Set())

    await expandDirectoryOwnerToTree(owner, 'kb-1', pathPrefix, createSignal(), onCopyProgress)

    expect(onCopyProgress.mock.calls.map(([percent]) => percent)).toEqual([0, 50, 100])
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
    const owner = createDirectoryOwner(rootDir)
    const children = await expandDirectoryOwnerToTree(
      owner,
      'kb-1',
      chooseDirectoryPathPrefix(owner, new Set()),
      createSignal(),
      ignoreCopyProgress
    )

    const relativePaths = JSON.stringify(children)
    expect(relativePaths).toContain('project/a/notes.md')
    expect(relativePaths).toContain('project/b/notes.md')
    // No collision: copy is invoked once per file with a unique target path.
    const copiedTargets = copyFileIntoKnowledgeBaseAtMock.mock.calls.map((call) => call[2])
    expect(new Set(copiedTargets).size).toBe(copiedTargets.length)
  })

  it('stores children under a deduped prefix passed in by the caller', async () => {
    tempRoot = createTempRoot()
    const rootDir = path.join(tempRoot, 'project')
    realFs.mkdirSync(rootDir, { recursive: true })
    realFs.writeFileSync(path.join(rootDir, 'notes.md'), '# notes')

    const owner = createDirectoryOwner(rootDir)
    // A prior `project` directory already occupies that top-level name under raw/.
    const pathPrefix = chooseDirectoryPathPrefix(owner, new Set(['project']))
    const children = await expandDirectoryOwnerToTree(owner, 'kb-1', pathPrefix, createSignal(), ignoreCopyProgress)

    expect(pathPrefix).toBe('project_1')
    expect(children).toEqual([
      {
        type: 'file',
        data: {
          source: path.join(rootDir, 'notes.md'),
          relativePath: 'project_1/notes.md'
        }
      }
    ])
  })

  it('dedupes a dotted directory name after the whole basename, not before a fake extension', async () => {
    tempRoot = createTempRoot()
    // A folder literally named `report.v2`: the trailing `.v2` is part of the name,
    // not a file extension, so the suffix must land after it (`report.v2_1`).
    const rootDir = path.join(tempRoot, 'report.v2')
    realFs.mkdirSync(rootDir, { recursive: true })
    realFs.writeFileSync(path.join(rootDir, 'notes.md'), '# notes')

    const owner = createDirectoryOwner(rootDir)
    // A prior `report.v2` directory already occupies that top-level name under raw/.
    const pathPrefix = chooseDirectoryPathPrefix(owner, new Set(['report.v2']))
    const children = await expandDirectoryOwnerToTree(owner, 'kb-1', pathPrefix, createSignal(), ignoreCopyProgress)

    expect(pathPrefix).toBe('report.v2_1')
    expect(children).toEqual([
      {
        type: 'file',
        data: {
          source: path.join(rootDir, 'notes.md'),
          relativePath: 'report.v2_1/notes.md'
        }
      }
    ])
  })

  it('stops before reading when the runtime signal is already aborted', async () => {
    tempRoot = createTempRoot()
    const controller = new AbortController()
    const abortError = new Error('interrupted')
    controller.abort(abortError)

    await expect(
      expandDirectoryOwnerToTree(createDirectoryOwner(tempRoot), 'kb-1', 'root', controller.signal, ignoreCopyProgress)
    ).rejects.toBe(abortError)
  })
})
