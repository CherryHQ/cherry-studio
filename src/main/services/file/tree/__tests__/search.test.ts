import type * as NodeChildProcess from 'node:child_process'
import { EventEmitter } from 'node:events'
import type * as NodeFs from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'

import type { AbsoluteFilePath } from '@shared/types/file'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { tryTestRipgrepPath } from './ripgrepTestUtils'

const ripgrepAvailable = tryTestRipgrepPath() !== null

// Hoisted mocks for the two `node:fs` surfaces `search.ts` consults:
//   - `existsSync` drives ripgrep binary discovery
//   - `promises.stat` drives the EACCES root-path branch
// Every other export passes through to the real implementation via the
// `vi.mock` factory below, so the happy-path tests below keep exercising
// real fs / real ripgrep without per-test setup.
const mockExistsSync = vi.hoisted(() => vi.fn())
const mockPromisesStat = vi.hoisted(() => vi.fn())
const mockSpawn = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeChildProcess>()
  return {
    ...actual,
    spawn: mockSpawn
  }
})

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>()
  return {
    ...actual,
    existsSync: mockExistsSync,
    promises: {
      ...actual.promises,
      stat: mockPromisesStat
    }
  }
})

// Production resolves ripgrep via BinaryManager (`getBinaryPath('rg')`), which
// reads cherry.bin / mise shims — neither is populated under vitest. Point it
// at the test ripgrep binary so scans spawn a real ripgrep; `existsSync` (mocked
// above) still governs the "binary not available" branch.
vi.mock('@main/utils/binaryResolver', async () => {
  const { tryTestRipgrepPath } = await import('./ripgrepTestUtils')
  // When ripgrep is unavailable, return a non-existent sentinel path so
  // `resolveRipgrepBinary`'s existsSync check (not testRipgrepPath) governs
  // binary availability — keeping the error-path test's assertion correct.
  const resolvedRgPath = tryTestRipgrepPath() ?? '/nonexistent/rg'
  return {
    getBinaryPath: async (name?: string) => (name === 'rg' ? resolvedRgPath : (name ?? ''))
  }
})

vi.mock('@main/utils/binaryEnv', () => ({
  getBinaryExecutionEnv: () => ({})
}))

const { listDirectory, listDirectoryEntries } = await import('../search')

beforeEach(async () => {
  // Default the spies to real-process / real-fs passthrough so the happy-path
  // suites below keep operating on actual tmp directories + the vendored
  // ripgrep binary. Individual error-path tests override per-call.
  const actual = await vi.importActual<typeof NodeFs>('node:fs')
  const actualChildProcess = await vi.importActual<typeof NodeChildProcess>('node:child_process')
  mockExistsSync.mockReset()
  mockPromisesStat.mockReset()
  mockSpawn.mockReset()
  mockExistsSync.mockImplementation((p: NodeFs.PathLike) => actual.existsSync(p))
  mockPromisesStat.mockImplementation((p: string) => actual.promises.stat(p))
  mockSpawn.mockImplementation(actualChildProcess.spawn)
})

const mockRipgrepResultOnce = ({
  exitCode,
  stdout = '',
  stderr = ''
}: {
  exitCode: number
  stdout?: string
  stderr?: string
}) => {
  const child = new EventEmitter() as ReturnType<typeof NodeChildProcess.spawn>
  const stdoutStream = new PassThrough()
  const stderrStream = new PassThrough()
  child.stdout = stdoutStream
  child.stderr = stderrStream
  mockSpawn.mockImplementationOnce(() => {
    queueMicrotask(() => {
      stdoutStream.end(stdout)
      stderrStream.end(stderr)
      child.emit('close', exitCode, null)
    })
    return child
  })
}

const createMockRipgrepChild = (
  exitCode: number,
  { stdout = '', stderr = '' }: { stdout?: string; stderr?: string } = {}
): NodeChildProcess.ChildProcessWithoutNullStreams => {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough()
  })

  queueMicrotask(() => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout))
    if (stderr) child.stderr.emit('data', Buffer.from(stderr))
    child.emit('close', exitCode, null)
  })

  return child as unknown as NodeChildProcess.ChildProcessWithoutNullStreams
}

const writeMany = async (root: string, count: number, prefix = 'file', ext = '.txt'): Promise<string[]> => {
  const created: string[] = []
  for (let i = 0; i < count; i++) {
    const name = `${prefix}-${String(i).padStart(3, '0')}${ext}`
    const p = path.join(root, name)
    await writeFile(p, `payload ${i}`)
    created.push(p.replace(/\\/g, '/'))
  }
  return created
}

describe.skipIf(!ripgrepAvailable)('listDirectory (list mode, no searchPattern)', () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-search-list-'))
  })
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('returns every entry — no silent truncation at the legacy 20-cap default', async () => {
    // 75 files exercises the > 50 threshold called out in the PR plan and
    // would have been chopped to 20 under the old `maxEntries` default.
    await writeMany(tmp, 75)
    const results = await listDirectory(tmp as AbsoluteFilePath)
    expect(results.length).toBe(75)
  })

  it('uses the BinaryManager-resolved ripgrep path', async () => {
    await writeFile(path.join(tmp, 'root.md'), 'root')

    await listDirectory(tmp as AbsoluteFilePath)

    const checkedPaths = mockExistsSync.mock.calls.map(([p]) => String(p).replace(/\\/g, '/'))
    expect(checkedPaths.some((p) => path.basename(p) === (process.platform === 'win32' ? 'rg.exe' : 'rg'))).toBe(true)
  })

  it('lists nested directories and files alongside top-level entries', async () => {
    await writeFile(path.join(tmp, 'root.md'), 'root')
    await mkdir(path.join(tmp, 'sub'))
    await writeFile(path.join(tmp, 'sub', 'inner.md'), 'inner')

    const results = await listDirectory(tmp as AbsoluteFilePath)
    const basenames = results.map((p) => path.basename(p))
    expect(basenames).toContain('root.md')
    expect(basenames).toContain('inner.md')
    expect(basenames).toContain('sub')
  })

  it('omits hidden files by default and surfaces them when includeHidden=true', async () => {
    await writeFile(path.join(tmp, 'visible.txt'), '1')
    await writeFile(path.join(tmp, '.hidden'), '2')

    const defaultRun = await listDirectory(tmp as AbsoluteFilePath)
    expect(defaultRun.some((p) => p.endsWith('/.hidden'))).toBe(false)

    const withHidden = await listDirectory(tmp as AbsoluteFilePath, { includeHidden: true })
    expect(withHidden.some((p) => p.endsWith('/.hidden'))).toBe(true)
  })

  it('honors maxDepth=1 by skipping nested-tree contents', async () => {
    await writeFile(path.join(tmp, 'top.md'), 'top')
    await mkdir(path.join(tmp, 'sub'))
    await writeFile(path.join(tmp, 'sub', 'nested.md'), 'nested')

    const results = await listDirectory(tmp as AbsoluteFilePath, { maxDepth: 1 })
    const basenames = results.map((p) => path.basename(p))
    expect(basenames).toContain('top.md')
    expect(basenames).not.toContain('nested.md')
  })
})

describe.skipIf(!ripgrepAvailable)('listDirectory (search mode, fuzzy + maxEntries)', () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-search-search-'))
  })
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('caps results at the caller-supplied maxEntries', async () => {
    // 12 files share the "update" stem; caller asks for 5.
    for (let i = 0; i < 12; i++) {
      await writeFile(path.join(tmp, `updater-${i}.ts`), 'x')
    }
    const results = await listDirectory(tmp as AbsoluteFilePath, {
      searchPattern: 'updater',
      maxEntries: 5
    })
    expect(results.length).toBe(5)
    for (const file of results) {
      expect(path.basename(file)).toMatch(/updater/)
    }
  })

  it('ranks filename-prefix matches above unrelated paths', async () => {
    await writeFile(path.join(tmp, 'updater.ts'), 'a')
    await writeFile(path.join(tmp, 'unrelated.ts'), 'b')
    await mkdir(path.join(tmp, 'misc'))
    await writeFile(path.join(tmp, 'misc', 'inner-updater.ts'), 'c')

    const results = await listDirectory(tmp as AbsoluteFilePath, {
      searchPattern: 'updater',
      maxEntries: 10
    })

    expect(results[0]).toMatch(/updater\.ts$/)
    expect(results.some((p) => p.endsWith('unrelated.ts'))).toBe(false)
  })

  it('keeps valid files when ripgrep reports a non-fatal traversal error', async () => {
    const validFile = path.join(tmp, 'readable.md').replace(/\\/g, '/')
    await writeFile(validFile, 'readable')

    mockRipgrepResultOnce({
      exitCode: 2,
      stdout: `${validFile}\n`,
      stderr: 'rg: locked-directory: Access is denied. (os error 5)\n'
    })

    await expect(
      listDirectory(tmp as AbsoluteFilePath, {
        includeDirectories: false,
        searchPattern: 'readable'
      })
    ).resolves.toEqual([validFile])
  })

  it('rejects a ripgrep traversal error without usable files', async () => {
    mockRipgrepResultOnce({
      exitCode: 2,
      stderr: 'rg: locked-directory: Access is denied. (os error 5)\n'
    })

    await expect(
      listDirectory(tmp as AbsoluteFilePath, {
        includeDirectories: false,
        searchPattern: 'readable'
      })
    ).rejects.toThrow(/Ripgrep failed with exit code 2:.*Access is denied/)
  })

  it('does not fuzzy-match candidates through the absolute search-root prefix', async () => {
    const searchRoot = path.join(tmp, 'target-root')
    await mkdir(path.join(searchRoot, 'unrelated-dir'), { recursive: true })
    await mkdir(path.join(searchRoot, 'target-dir'))
    await writeFile(path.join(searchRoot, 'unrelated-file.md'), 'unrelated')

    const results = await listDirectoryEntries(searchRoot as AbsoluteFilePath, {
      includeFiles: true,
      includeDirectories: true,
      searchPattern: 'target'
    })

    expect(results).toEqual([
      {
        path: path.join(searchRoot, 'target-dir').replace(/\\/g, '/'),
        isDirectory: true
      }
    ])
  })

  it('falls back to scanning all files when the ripgrep glob misses a cross-segment fuzzy match', async () => {
    await mkdir(path.join(tmp, 'alpha'))
    await writeFile(path.join(tmp, 'alpha', 'beta.md'), 'match across path segments')

    const results = await listDirectoryEntries(tmp as AbsoluteFilePath, {
      includeFiles: true,
      includeDirectories: false,
      searchPattern: 'ab'
    })

    expect(results).toEqual([
      {
        path: path.join(tmp, 'alpha', 'beta.md').replace(/\\/g, '/'),
        isDirectory: false
      }
    ])
    expect(mockSpawn).toHaveBeenCalledTimes(2)
  })

  it('returns empty directories from a directory-only fuzzy search', async () => {
    await mkdir(path.join(tmp, 'documentation'))
    await mkdir(path.join(tmp, 'other'))
    await writeFile(path.join(tmp, 'documentation-file.md'), 'docs')

    const results = await listDirectoryEntries(tmp as AbsoluteFilePath, {
      recursive: true,
      includeFiles: false,
      includeDirectories: true,
      searchPattern: 'dcmnttn'
    })

    expect(results).toEqual([
      {
        path: path.join(tmp, 'documentation').replace(/\\/g, '/'),
        isDirectory: true
      }
    ])
  })

  it('excludes matching directories from a file-only fuzzy search', async () => {
    await mkdir(path.join(tmp, 'notes-folder'))
    await writeFile(path.join(tmp, 'notes-file.md'), 'notes')

    const results = await listDirectoryEntries(tmp as AbsoluteFilePath, {
      includeFiles: true,
      includeDirectories: false,
      searchPattern: 'notes'
    })

    expect(results).toEqual([
      {
        path: path.join(tmp, 'notes-file.md').replace(/\\/g, '/'),
        isDirectory: false
      }
    ])
  })

  it('merges files and directories before maxEntries and ranks directories first on score ties', async () => {
    await mkdir(path.join(tmp, 'a', 'q'), { recursive: true })
    await mkdir(path.join(tmp, 'b'))
    await writeFile(path.join(tmp, 'b', 'q'), 'q')
    await mkdir(path.join(tmp, 'c'))
    await writeFile(path.join(tmp, 'c', 'q'), 'q')

    const results = await listDirectoryEntries(tmp as AbsoluteFilePath, {
      searchPattern: 'q',
      maxEntries: 2
    })

    expect(results).toHaveLength(2)
    expect(results.map((entry) => entry.isDirectory)).toEqual([true, false])
    expect(results.map((entry) => entry.path)).toEqual([
      path.join(tmp, 'a', 'q').replace(/\\/g, '/'),
      path.join(tmp, 'b', 'q').replace(/\\/g, '/')
    ])
  })

  it('honors depth, hidden, and excluded-directory constraints for fuzzy directory candidates', async () => {
    await mkdir(path.join(tmp, 'visible', 'target'), { recursive: true })
    await mkdir(path.join(tmp, '.hidden', 'target'), { recursive: true })
    await mkdir(path.join(tmp, 'node_modules', 'target'), { recursive: true })
    await mkdir(path.join(tmp, 'deep', 'one', 'target'), { recursive: true })

    const results = await listDirectory(tmp as AbsoluteFilePath, {
      recursive: true,
      maxDepth: 2,
      includeHidden: false,
      includeFiles: false,
      includeDirectories: true,
      searchPattern: 'target'
    })

    expect(results).toEqual([path.join(tmp, 'visible', 'target').replace(/\\/g, '/')])
  })

  it('treats maxDepth=0 as unlimited for fuzzy directory candidates', async () => {
    await mkdir(path.join(tmp, 'deep', 'one', 'target-empty'), { recursive: true })

    const results = await listDirectory(tmp as AbsoluteFilePath, {
      recursive: true,
      maxDepth: 0,
      includeFiles: false,
      includeDirectories: true,
      searchPattern: 'target'
    })

    expect(results).toEqual([path.join(tmp, 'deep', 'one', 'target-empty').replace(/\\/g, '/')])
  })
})

describe('listDirectory (directory-only fuzzy options)', () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-search-directory-options-'))
  })
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('does not return nested matches when recursive=false', async () => {
    await mkdir(path.join(tmp, 'target-root'))
    await mkdir(path.join(tmp, 'container', 'target-nested'), { recursive: true })

    const results = await listDirectoryEntries(tmp as AbsoluteFilePath, {
      recursive: false,
      includeFiles: false,
      includeDirectories: true,
      searchPattern: 'target'
    })

    expect(results).toEqual([
      {
        path: path.join(tmp, 'target-root').replace(/\\/g, '/'),
        isDirectory: true
      }
    ])
  })

  it('returns matching hidden directories when includeHidden=true', async () => {
    await mkdir(path.join(tmp, '.target-hidden'))
    await mkdir(path.join(tmp, 'other'))

    const results = await listDirectoryEntries(tmp as AbsoluteFilePath, {
      includeHidden: true,
      includeFiles: false,
      includeDirectories: true,
      searchPattern: 'target'
    })

    expect(results).toEqual([
      {
        path: path.join(tmp, '.target-hidden').replace(/\\/g, '/'),
        isDirectory: true
      }
    ])
  })

  it('ranks candidates by their root-relative paths', async () => {
    const searchRoot = path.join(tmp, 'abc-root')
    await mkdir(path.join(searchRoot, 'a-long-bc'), { recursive: true })
    await mkdir(path.join(searchRoot, 'a-b-c'))

    // Relative scoring rewards the consecutive "bc" in a-long-bc. Scoring
    // the absolute paths would instead satisfy "abc" in the shared root and
    // let the path-length penalty incorrectly prefer the shorter a-b-c.
    const results = await listDirectoryEntries(searchRoot as AbsoluteFilePath, {
      includeFiles: false,
      includeDirectories: true,
      searchPattern: 'abc',
      maxEntries: 1
    })

    expect(results).toEqual([
      {
        path: path.join(searchRoot, 'a-long-bc').replace(/\\/g, '/'),
        isDirectory: true
      }
    ])
  })
})

describe('listDirectory (error paths)', () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-search-errors-'))
  })
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('returns directory-only fuzzy results when ripgrep is unavailable', async () => {
    await mkdir(path.join(tmp, 'docs-empty'))
    mockExistsSync.mockReturnValue(false)

    const results = await listDirectory(tmp as AbsoluteFilePath, {
      includeFiles: false,
      includeDirectories: true,
      searchPattern: 'docs'
    })

    expect(results).toEqual([path.join(tmp, 'docs-empty').replace(/\\/g, '/')])
  })

  it('throws "Ripgrep binary not available" when the test ripgrep binary cannot be located', async () => {
    // Force `resolveRipgrepBinary()` to treat the resolved path as missing:
    // `existsSync` returns false, so the binary check fails. `stat` keeps its
    // passthrough so the directory check still succeeds — the throw must come
    // from the binary-availability branch, not a stat failure masquerading as
    // a missing binary.
    mockExistsSync.mockReturnValue(false)

    await expect(listDirectory(tmp as AbsoluteFilePath)).rejects.toThrow(/Ripgrep binary not available/)
  })

  it('propagates a ripgrep fallback failure after the glob returns no matches', async () => {
    mockExistsSync.mockReturnValue(true)
    mockSpawn
      .mockImplementationOnce(() => createMockRipgrepChild(1))
      .mockImplementationOnce(() => createMockRipgrepChild(2, { stderr: 'fallback failed' }))

    await expect(
      listDirectory(tmp as AbsoluteFilePath, {
        includeFiles: true,
        includeDirectories: false,
        searchPattern: 'ab'
      })
    ).rejects.toThrow('Ripgrep failed with exit code 2: fallback failed')
    expect(mockSpawn).toHaveBeenCalledTimes(2)
  })

  it('throws when the root path is not readable (EACCES from fs.promises.stat)', async () => {
    // The stat call catch-logs + rethrows the original
    // error verbatim, so callers see the underlying EACCES — not a
    // synthesized "Path is not a directory" or "Ripgrep binary" message.
    const eaccesErr = Object.assign(new Error('permission denied'), {
      code: 'EACCES'
    }) as NodeJS.ErrnoException
    mockPromisesStat.mockRejectedValueOnce(eaccesErr)

    await expect(listDirectory('/some/locked/path' as AbsoluteFilePath)).rejects.toBe(eaccesErr)
  })
})
