import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ZipArchive } from 'archiver'
import StreamZip from 'node-stream-zip'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Integration guard for the archiver 7 -> 8 migration.
 *
 * The consumer of this API — `LegacyBackupManager` — is `@deprecated` v1-verbatim
 * code marked "DO NOT MODIFY", so instead of refactoring it for testability this
 * exercises the exact archiver-8 surface it depends on with a real (unmocked)
 * archive: `new ZipArchive({ zlib })` + `.pipe()` + `.directory(dir, false)` +
 * `.append()` + `.finalize()`. The ZIP is then read back with `node-stream-zip`
 * — the same library `LegacyBackupManager` uses on the restore path — so the
 * full create -> read round-trip is covered, not just the constructor shape.
 */
describe('archiver 8 ZIP round-trip (LegacyBackupManager API contract)', () => {
  let workDir: string

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'cherry-archiver8-'))
  })

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  it('creates a readable ZIP via directory() + append() and reads every entry back', async () => {
    // Arrange: a source tree mirroring what the backup manager zips via
    // `archive.directory(this.tempDir, false)`.
    const srcDir = join(workDir, 'src')
    await mkdir(join(srcDir, 'nested'), { recursive: true })
    await writeFile(join(srcDir, 'root.txt'), 'root-content')
    await writeFile(join(srcDir, 'nested', 'inner.txt'), 'inner-content')

    const zipPath = join(workDir, 'out.zip')

    // Act: build the archive using the exact archiver-8 calls the manager makes.
    await new Promise<void>((resolve, reject) => {
      const output = createWriteStream(zipPath)
      const archive = new ZipArchive({ zlib: { level: 1 } })
      output.on('close', () => resolve())
      output.on('error', reject)
      archive.on('error', reject)
      archive.pipe(output)
      archive.directory(srcDir, false)
      archive.append('extra-content', { name: 'extra.txt' })
      archive.finalize()
    })

    // Assert: the archive is valid and every file round-trips with intact content.
    const zip = new StreamZip.async({ file: zipPath })
    try {
      const names = Object.keys(await zip.entries())
      expect(names).toContain('root.txt')
      expect(names).toContain('nested/inner.txt')
      expect(names).toContain('extra.txt')

      expect((await zip.entryData('root.txt')).toString()).toBe('root-content')
      expect((await zip.entryData('nested/inner.txt')).toString()).toBe('inner-content')
      expect((await zip.entryData('extra.txt')).toString()).toBe('extra-content')
    } finally {
      await zip.close()
    }
  })
})
