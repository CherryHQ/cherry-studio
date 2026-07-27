import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { bench, describe } from 'vitest'

import { fsyncParentDirsBatched } from '../fsyncBatch'

/**
 * NON-GATING benchmark (runs only under `pnpm vitest bench`, never `vitest run`).
 * Bounded to 100 files. It illustrates that `fsyncParentDirsBatched` cost tracks
 * the number of DISTINCT parent directories, not the file count: 100 files in one
 * directory performs a single fsync, while 100 files across 100 directories
 * performs 100. No timing is asserted — the gating guarantee is the fsync-COUNT
 * fixture in `fsyncBatch.test.ts`. A recorded run lives in `fsyncBatch.bench.md`.
 */

const FILE_COUNT = 100

function makeTree(dirCount: number): { root: string; files: string[] } {
  const root = mkdtempSync(path.join(tmpdir(), 'bk-fsbench-'))
  const files: string[] = []
  for (let i = 0; i < FILE_COUNT; i++) {
    const d = path.join(root, `d${i % dirCount}`)
    mkdirSync(d, { recursive: true })
    const f = path.join(d, `f${i}`)
    writeFileSync(f, 'x')
    files.push(f)
  }
  return { root, files }
}

const oneDir = makeTree(1)
const hundredDirs = makeTree(FILE_COUNT)

describe('fsyncParentDirsBatched', () => {
  bench(`${FILE_COUNT} files in 1 directory (1 fsync)`, async () => {
    await fsyncParentDirsBatched(oneDir.files)
  })

  bench(`${FILE_COUNT} files across ${FILE_COUNT} directories (${FILE_COUNT} fsyncs)`, async () => {
    await fsyncParentDirsBatched(hundredDirs.files)
  })
})

process.on('exit', () => {
  rmSync(oneDir.root, { recursive: true, force: true })
  rmSync(hundredDirs.root, { recursive: true, force: true })
})
