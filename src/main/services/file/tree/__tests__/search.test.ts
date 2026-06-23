import type * as NodeFs from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { FilePath } from '@shared/types/file'
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
vi.mock('@main/utils/process', async () => {
  const { tryTestRipgrepPath } = await import('./ripgrepTestUtils')
  // When ripgrep is unavailable, return a non-existent sentinel path so
  // `resolveRipgrepBinary`'s existsSync check (not testRipgrepPath) governs
  // binary availability — keeping the error-path test's assertion correct.
  const resolvedRgPath = tryTestRipgrepPath() ?? '/nonexistent/rg'
  return {
    getBinaryExecutionEnv: () => ({}),
    getBinaryPath: async (name?: string) => (name === 'rg' ? resolvedRgPath : (name ?? ''))
  }
})

const { listDirectory } = await import('../search')

beforeEach(async () => {
  // Default both spies to real-fs passthrough so the existing happy-path
  // suites below keep operating on actual tmp directories + the vendored
  // ripgrep binary. Individual error-path tests override per-call.
  const actual = await vi.importActual<typeof NodeFs>('node:fs')
  mockExistsSync.mockReset()
  mockPromisesStat.mockReset()
  mockExistsSync.mockImplementation((p: NodeFs.PathLike) => actual.existsSync(p))
  mockPromisesStat.mockImplementation((p: string) => actual.promises.stat(p))
})

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
    const results = await listDirectory(tmp as FilePath)
    expect(results.length).toBe(75)
  })

  it('uses the BinaryManager-resolved ripgrep path', async () => {
    await writeFile(path.join(tmp, 'root.md'), 'root')

    await listDirectory(tmp as FilePath)

    const checkedPaths = mockExistsSync.mock.calls.map(([p]) => String(p).replace(/\\/g, '/'))
    expect(checkedPaths.some((p) => path.basename(p) === (process.platform === 'win32' ? 'rg.exe' : 'rg'))).toBe(true)
  })

  it('lists nested directories and files alongside top-level entries', async () => {
    await writeFile(path.join(tmp, 'root.md'), 'root')
    await mkdir(path.join(tmp, 'sub'))
    await writeFile(path.join(tmp, 'sub', 'inner.md'), 'inner')

    const results = await listDirectory(tmp as FilePath)
    const basenames = results.map((p) => path.basename(p))
    expect(basenames).toContain('root.md')
    expect(basenames).toContain('inner.md')
    expect(basenames).toContain('sub')
  })

  it('omits hidden files by default and surfaces them when includeHidden=true', async () => {
    await writeFile(path.join(tmp, 'visible.txt'), '1')
    await writeFile(path.join(tmp, '.hidden'), '2')

    const defaultRun = await listDirectory(tmp as FilePath)
    expect(defaultRun.some((p) => p.endsWith('/.hidden'))).toBe(false)

    const withHidden = await listDirectory(tmp as FilePath, { includeHidden: true })
    expect(withHidden.some((p) => p.endsWith('/.hidden'))).toBe(true)
  })

  it('honors maxDepth=1 by skipping nested-tree contents', async () => {
    await writeFile(path.join(tmp, 'top.md'), 'top')
    await mkdir(path.join(tmp, 'sub'))
    await writeFile(path.join(tmp, 'sub', 'nested.md'), 'nested')

    const results = await listDirectory(tmp as FilePath, { maxDepth: 1 })
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
    const results = await listDirectory(tmp as FilePath, {
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

    const results = await listDirectory(tmp as FilePath, {
      searchPattern: 'updater',
      maxEntries: 10
    })

    expect(results[0]).toMatch(/updater\.ts$/)
    expect(results.some((p) => p.endsWith('unrelated.ts'))).toBe(false)
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

  it('throws "Ripgrep binary not available" when the test ripgrep binary cannot be located', async () => {
    // Force `resolveRipgrepBinary()` to treat the resolved path as missing:
    // `existsSync` returns false, so the binary check fails. `stat` keeps its
    // passthrough so the directory check still succeeds — the throw must come
    // from the binary-availability branch, not a stat failure masquerading as
    // a missing binary.
    mockExistsSync.mockReturnValue(false)

    await expect(listDirectory(tmp as FilePath)).rejects.toThrow(/Ripgrep binary not available/)
  })

  it('throws when the root path is not readable (EACCES from fs.promises.stat)', async () => {
    // The stat call (search.ts:532) catch-logs + rethrows the original
    // error verbatim, so callers see the underlying EACCES — not a
    // synthesized "Path is not a directory" or "Ripgrep binary" message.
    const eaccesErr = Object.assign(new Error('permission denied'), {
      code: 'EACCES'
    }) as NodeJS.ErrnoException
    mockPromisesStat.mockRejectedValueOnce(eaccesErr)

    await expect(listDirectory('/some/locked/path' as FilePath)).rejects.toBe(eaccesErr)
  })
})
