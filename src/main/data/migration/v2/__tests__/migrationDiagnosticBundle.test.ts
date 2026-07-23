import { appendFileSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import {
  access,
  type FileHandle,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
import { release, tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'

import { application } from '@application'
import type { FilePath } from '@shared/types/file'
import { app } from 'electron'
import StreamZip from 'node-stream-zip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { saveMigrationDiagnosticBundle } from '../migrationDiagnosticBundle'

const LOG_DATE = '2026-07-22'
const GENERATED_AT = '2026-07-23T04:05:06.000Z'

type Dependencies = Parameters<typeof saveMigrationDiagnosticBundle>[1]

describe('saveMigrationDiagnosticBundle', () => {
  let workDir: string
  let logsDir: string

  beforeEach(async () => {
    vi.clearAllMocks()
    workDir = await mkdtemp(path.join(tmpdir(), 'migration-diagnostics-'))
    logsDir = path.join(workDir, 'logs')
    await mkdir(logsDir)
    vi.mocked(application.getPath).mockImplementation((key: string, fileName?: string) => {
      if (key === 'app.logs') return fileName ? path.join(logsDir, fileName) : logsDir
      return fileName ? `/mock/${key}/${fileName}` : `/mock/${key}`
    })
    vi.mocked(app.getVersion).mockReturnValue('2.7.0-test')
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  const logPath = (fileName = `app.${LOG_DATE}.log`) => path.join(logsDir, fileName)
  const destination = (fileName = 'diagnostics.zip') => path.join(workDir, fileName)
  const writeLog = (fileName: string, content: string) => writeFile(logPath(fileName), content)
  const save = (target: string, dependencies: Dependencies = {}, logDate = LOG_DATE) =>
    saveMigrationDiagnosticBundle(
      { destination: target, stage: 'error', logDate },
      { clock: () => new Date(GENERATED_AT), ...dependencies }
    )

  async function readZip(zipPath: string) {
    const zip = new StreamZip.async({ file: zipPath })
    try {
      const entries = Object.keys(await zip.entries()).sort()
      const contents: Record<string, Buffer> = {}
      for (const entry of entries) contents[entry] = await zip.entryData(entry)
      return { entries, contents }
    } finally {
      await zip.close()
    }
  }

  async function expectMetadataOnly(zipPath: string) {
    const zip = await readZip(zipPath)
    expect(zip.entries).toEqual(['migration-diagnostics.json'])
    return JSON.parse(zip.contents['migration-diagnostics.json'].toString())
  }

  async function expectClosed(handles: FileHandle[]) {
    for (const handle of handles) {
      await expect(handle.stat()).rejects.toMatchObject({ code: 'EBADF' })
    }
  }

  async function expectNoAtomicResidue() {
    expect((await readdir(workDir)).filter((name) => name.includes('.tmp-'))).toEqual([])
  }

  it('writes minimal system metadata without failure details', async () => {
    await writeLog(`app.${LOG_DATE}.log`, 'migration failed')

    expect(await save(destination())).toBe('included')
    const zip = await readZip(destination())
    expect(zip.entries).toEqual([`logs/app.${LOG_DATE}.log`, 'migration-diagnostics.json'])
    const metadata = JSON.parse(zip.contents['migration-diagnostics.json'].toString())
    expect(Object.keys(metadata)).toEqual(['formatVersion', 'generatedAt', 'application', 'system', 'migration'])
    expect(Object.keys(metadata.application)).toEqual(['version'])
    expect(Object.keys(metadata.system)).toEqual(['platform', 'arch', 'release'])
    expect(Object.keys(metadata.migration)).toEqual(['stage'])
    expect(metadata).toEqual({
      formatVersion: 1,
      generatedAt: GENERATED_AT,
      application: { version: '2.7.0-test' },
      system: { platform: process.platform, arch: process.arch, release: release() },
      migration: { stage: 'error' }
    })
    expect(JSON.stringify(metadata)).not.toMatch(/"(?:error|stack|cause|path|processId|runId)"\s*:/)
  })

  it('uses the failure-page log date even when a newer date exists', async () => {
    await Promise.all([
      writeLog(`app.${LOG_DATE}.log`, 'base'),
      writeLog(`app.${LOG_DATE}.log.2`, 'rotation'),
      writeLog('app.2026-07-23.log', 'newer'),
      writeLog(`app-error.${LOG_DATE}.log`, 'error'),
      writeLog(`app.${LOG_DATE}.log.old`, 'bad suffix')
    ])
    await mkdir(logPath(`app.${LOG_DATE}.log.7`))

    expect(await save(destination())).toBe('included')
    expect((await readZip(destination())).entries).toEqual([
      `logs/app.${LOG_DATE}.log`,
      `logs/app.${LOG_DATE}.log.2`,
      'migration-diagnostics.json'
    ])
  })

  it('falls back to the latest eligible log date without combining dates', async () => {
    await Promise.all([
      writeLog('app.2026-07-20.log', 'older'),
      writeLog('app.2026-07-23.log', 'latest'),
      writeLog('app.2026-07-23.log.1', 'latest rotation'),
      writeLog('app.2027-02-31.log', 'invalid calendar date')
    ])

    expect(await save(destination(), {}, '2026-07-21')).toBe('included')
    expect((await readZip(destination())).entries).toEqual([
      'logs/app.2026-07-23.log',
      'logs/app.2026-07-23.log.1',
      'migration-diagnostics.json'
    ])
  })

  it('streams the opened fixed-length snapshot when a log is appended or replaced', async () => {
    const handles: FileHandle[] = []
    const source = logPath()
    await writeFile(source, 'opened')
    const openTracked = async (filePath: FilePath) => {
      const handle = await open(filePath, 'r')
      handles.push(handle)
      return handle
    }

    expect(
      await save(destination('appended.zip'), {
        openLogFile: openTracked,
        createLogReadStream: (handle, bytes) => {
          appendFileSync(source, '-later')
          return handle.createReadStream({ start: 0, end: bytes - 1, autoClose: false })
        }
      })
    ).toBe('included')
    expect((await readZip(destination('appended.zip'))).contents[`logs/app.${LOG_DATE}.log`].toString()).toBe('opened')

    await rm(logsDir, { recursive: true })
    await mkdir(logsDir)
    await writeFile(source, 'original inode')
    expect(
      await save(destination('replaced.zip'), {
        openLogFile: openTracked,
        createLogReadStream: (handle, bytes) => {
          renameSync(source, path.join(logsDir, 'opened.log'))
          writeFileSync(source, 'replacement')
          return handle.createReadStream({ start: 0, end: bytes - 1, autoClose: false })
        }
      })
    ).toBe('included')
    expect((await readZip(destination('replaced.zip'))).contents[`logs/app.${LOG_DATE}.log`].toString()).toBe(
      'original inode'
    )
    await expectClosed(handles)
  })

  it('rejects a matching symlink or changed inode before archiving', async () => {
    const other = path.join(logsDir, 'other.log')
    await writeFile(other, 'symlink target')
    await symlink(other, logPath())
    await writeLog(`app.${LOG_DATE}.log.1`, 'regular candidate')

    expect(await save(destination('symlink.zip'))).toBe('included')
    const symlinkZip = await readZip(destination('symlink.zip'))
    expect(symlinkZip.entries).toEqual([`logs/app.${LOG_DATE}.log.1`, 'migration-diagnostics.json'])
    expect(symlinkZip.contents[`logs/app.${LOG_DATE}.log.1`].toString()).toBe('regular candidate')

    await rm(logsDir, { recursive: true })
    await mkdir(logsDir)
    await Promise.all([writeFile(other, 'same size'), writeFile(logPath(), 'same size')])
    const [sourceStat, openedStat] = await Promise.all([lstat(logPath()), lstat(other)])
    expect(openedStat.size).toBe(sourceStat.size)
    expect([openedStat.dev, openedStat.ino]).not.toEqual([sourceStat.dev, sourceStat.ino])
    const handles: FileHandle[] = []

    expect(
      await save(destination('changed-inode.zip'), {
        openLogFile: async () => {
          const handle = await open(other, 'r')
          handles.push(handle)
          return handle
        }
      })
    ).toBe('not_included')
    await expectMetadataOnly(destination('changed-inode.zip'))
    expect(handles).toHaveLength(1)
    await expectClosed(handles)
  })

  it('rebuilds metadata-only when a selected snapshot becomes shorter or its stream fails', async () => {
    for (const failure of ['short', 'error'] as const) {
      await rm(logsDir, { recursive: true })
      await mkdir(logsDir)
      await Promise.all([writeLog(`app.${LOG_DATE}.log`, 'first'), writeLog(`app.${LOG_DATE}.log.1`, 'second')])
      const handles: FileHandle[] = []
      const clock = vi.fn(() => new Date(GENERATED_AT))
      let streamIndex = 0
      const target = destination(`${failure}.zip`)

      expect(
        await save(target, {
          clock,
          openLogFile: async (filePath) => {
            const handle = await open(filePath, 'r')
            handles.push(handle)
            return handle
          },
          createLogReadStream: (handle, bytes) => {
            streamIndex += 1
            if (streamIndex === 1) {
              return handle.createReadStream({ start: 0, end: bytes - 1, autoClose: false })
            }
            if (failure === 'short') return Readable.from(Buffer.alloc(bytes - 1))
            return new Readable({ read: () => undefined }).destroy(new Error('injected stream failure'))
          }
        })
      ).toBe('not_included')
      const metadata = await expectMetadataOnly(target)
      expect(metadata.generatedAt).toBe(GENERATED_AT)
      expect(clock).toHaveBeenCalledTimes(1)
      await expectClosed(handles)
      await expectNoAtomicResidue()
    }
  })

  it('returns not_included when no eligible application log exists', async () => {
    await Promise.all([
      writeLog(`app-error.${LOG_DATE}.log`, 'error'),
      writeLog(`app.${LOG_DATE}.log.old`, 'bad suffix'),
      writeLog('app.2026-02-31.log', 'invalid date')
    ])
    await mkdir(logPath())

    expect(await save(destination())).toBe('not_included')
    await expectMetadataOnly(destination())
  })

  it('rejects a relative, root, or basename-less destination', async () => {
    const clock = vi.fn(() => new Date(GENERATED_AT))
    for (const target of [
      'diagnostics.zip',
      '',
      path.parse(workDir).root,
      `${workDir}/.`,
      `${workDir}/..`,
      `${workDir}/child\\.`,
      `${workDir}/child\\..`
    ]) {
      expect(await save(target, { clock })).toBe(false)
    }
    expect(clock).not.toHaveBeenCalled()
    expect(application.getPath).not.toHaveBeenCalled()
  })

  it('refuses to overwrite a selected source log', async () => {
    await Promise.all([writeFile(logPath(), 'must survive'), writeLog(`app.${LOG_DATE}.log.1`, 'fails to open')])
    const target = destination()
    await link(logPath(), target)
    const handles: FileHandle[] = []

    expect(
      await save(target, {
        openLogFile: async (filePath) => {
          if (filePath.endsWith('.1')) throw new Error('injected second snapshot failure')
          const handle = await open(filePath, 'r')
          handles.push(handle)
          return handle
        }
      })
    ).toBe(false)
    expect(await readFile(logPath(), 'utf8')).toBe('must survive')
    expect(await readFile(target, 'utf8')).toBe('must survive')
    expect(handles).toHaveLength(1)
    await expectClosed(handles)
    await expectNoAtomicResidue()
  })

  it('does not publish the destination when archive creation fails', async () => {
    await writeFile(logPath(), 'log')
    const target = path.join(workDir, 'missing-parent', 'diagnostics.zip')
    const handles: FileHandle[] = []
    class LateCleanupErrorStream extends Readable {
      override _read() {}
      override destroy(error?: Error): this {
        mkdirSync(path.dirname(target), { recursive: true })
        this.emit('error', new Error('late cleanup log error'))
        return super.destroy(error)
      }
    }

    expect(
      await save(target, {
        openLogFile: async (filePath) => {
          const handle = await open(filePath, 'r')
          handles.push(handle)
          return handle
        },
        createLogReadStream: () => new LateCleanupErrorStream()
      })
    ).toBe(false)
    await expect(access(target)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(path.dirname(target))).toEqual([])
    await expectClosed(handles)
    await expectNoAtomicResidue()
  })
})
