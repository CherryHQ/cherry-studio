import { appendFile, mkdir, mkdtemp, readFile, rename, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { application } from '@application'
import type { AbsoluteFilePath } from '@shared/types/file'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  collectCrashDumpInventory,
  collectDiagnosticSources,
  SourceChangedError,
  stageSourceCandidate
} from '../sourceCollector'
import type { DiagnosticWarning } from '../types'

const ALL_SOURCES = { includeLogs: true, includeTraces: true } as const

function formatLogDate(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

describe('diagnostic source collection', () => {
  let workDir: string
  let logsDir: string
  let tracesDir: string
  let crashDumpsDir: string
  let tempDir: string

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'diagnostic-sources-'))
    logsDir = path.join(workDir, 'logs')
    tracesDir = path.join(workDir, 'traces')
    crashDumpsDir = path.join(workDir, 'crashes')
    tempDir = path.join(workDir, 'temp')
    await Promise.all([mkdir(logsDir), mkdir(tracesDir), mkdir(crashDumpsDir), mkdir(tempDir)])
    vi.mocked(application.getPath).mockImplementation((key: string, fileName?: string) => {
      const roots: Record<string, string> = {
        'app.crash_dumps': crashDumpsDir,
        'app.logs': logsDir,
        'app.temp': tempDir,
        'feature.trace': tracesDir
      }
      const root = roots[key] ?? workDir
      return fileName ? path.join(root, fileName) : root
    })
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  it('filters log and trace JSONL by record time while preserving eligible bytes', async () => {
    const now = Date.now()
    const logDate = formatLogDate(now)
    const recentLog = `${JSON.stringify({ level: 'info', message: 'recent', timestamp: new Date(now - 1_000).toISOString() })}\n`
    const oldLog = `${JSON.stringify({ level: 'info', message: 'old', timestamp: new Date(now - 2 * 86_400_000).toISOString() })}\n`
    const recentError = `${JSON.stringify({ level: 'warn', message: 'recent error', timestamp: new Date(now - 2_000).toISOString() })}\n`
    await Promise.all([
      writeFile(path.join(logsDir, `app.${logDate}.log`), `${oldLog}${recentLog}not-json\n`),
      writeFile(path.join(logsDir, `app-error.${logDate}.log`), recentError)
    ])

    // `:` and `*` exercise archive-name sanitisation but are unwriteable on Windows.
    const isWin = process.platform === 'win32'
    const topicDir = path.join(tracesDir, isWin ? 'topic-one' : 'topic:one')
    await mkdir(topicDir)
    const recentTrace = `${JSON.stringify({ id: 'recent', startTime: now - 3_000 })}\n`
    const oldTrace = `${JSON.stringify({ id: 'old', startTime: now - 2 * 86_400_000 })}\n`
    await writeFile(path.join(topicDir, isWin ? 'trace-one' : 'trace*one'), `${oldTrace}${recentTrace}`)

    const range = { fromMs: now - 86_400_000, toMs: now }
    const collection = await collectDiagnosticSources(range, ALL_SOURCES)

    expect(collection.logs).toHaveLength(2)
    expect(collection.traces).toHaveLength(1)
    expect(collection.warnings).toContain('malformed_lines')
    expect(collection.traces[0].archiveName).toMatch(/^traces\/[0-9a-f]+\/[0-9a-f]+\.jsonl$/)

    const stagedPath = path.join(tempDir, 'filtered.jsonl') as AbsoluteFilePath
    await stageSourceCandidate(
      collection.logs.find((candidate) => candidate.archiveName.includes('/app.'))!,
      range,
      stagedPath
    )
    expect(await readFile(stagedPath, 'utf8')).toBe(recentLog)
  })

  it('ignores trace files that are still being written', async () => {
    const now = Date.now()
    const topicDir = path.join(tracesDir, 'topic')
    await mkdir(topicDir)
    const traceLine = `${JSON.stringify({ id: 'recent', startTime: now - 1_000 })}\n`
    await Promise.all([
      writeFile(path.join(topicDir, 'completed-trace'), traceLine),
      writeFile(path.join(topicDir, `completed-trace.${process.pid}.tmp`), traceLine)
    ])

    const collection = await collectDiagnosticSources({ fromMs: now - 86_400_000, toMs: now }, ALL_SOURCES)

    expect(collection.traces).toHaveLength(1)
    expect(collection.traces[0].sourcePath).toBe(path.join(topicDir, 'completed-trace'))
    expect(collection.warnings).not.toContain('source_unreadable')
  })

  it('rejects a source whose inode changes after inspection', async () => {
    const now = Date.now()
    const source = path.join(logsDir, `app.${formatLogDate(now)}.log`)
    await writeFile(source, `${JSON.stringify({ timestamp: new Date(now - 1_000).toISOString() })}\n`)
    const range = { fromMs: now - 86_400_000, toMs: now }
    const collection = await collectDiagnosticSources(range, ALL_SOURCES)

    await rename(source, `${source}.old`)
    await writeFile(source, `${JSON.stringify({ timestamp: new Date(now - 2_000).toISOString() })}\n`)

    await expect(
      stageSourceCandidate(collection.logs[0], range, path.join(tempDir, 'filtered.jsonl') as AbsoluteFilePath)
    ).rejects.toBeInstanceOf(SourceChangedError)
  })

  it('uses record timestamps even when the source modification time is outside the range', async () => {
    const now = Date.now()
    const source = path.join(logsDir, `app.${formatLogDate(now)}.log`)
    const recentLine = `${JSON.stringify({ timestamp: new Date(now - 1_000).toISOString() })}\n`
    await writeFile(source, recentLine)
    const oldTime = new Date(now - 30 * 86_400_000)
    await utimes(source, oldTime, oldTime)

    const range = { fromMs: now - 86_400_000, toMs: now }
    const collection = await collectDiagnosticSources(range, ALL_SOURCES)

    expect(collection.logs).toHaveLength(1)
    const stagedPath = path.join(tempDir, 'mtime-filtered.jsonl') as AbsoluteFilePath
    await stageSourceCandidate(collection.logs[0], range, stagedPath)
    expect(await readFile(stagedPath, 'utf8')).toBe(recentLine)
  })

  it('skips log days and trace files that cannot overlap the requested range', async () => {
    const now = Date.now()
    await writeFile(path.join(logsDir, 'app.2020-01-01.log'), 'not-json\n')
    await writeFile(path.join(logsDir, 'app.2026-99-99.log'), 'not-json\n')

    const topicDir = path.join(tracesDir, 'old-topic')
    await mkdir(topicDir)
    const tracePath = path.join(topicDir, 'old-trace')
    await writeFile(tracePath, 'not-json\n')
    const oldTime = new Date(now - 30 * 86_400_000)
    await utimes(tracePath, oldTime, oldTime)

    const collection = await collectDiagnosticSources({ fromMs: now - 86_400_000, toMs: now }, ALL_SOURCES)

    expect(collection.logs).toEqual([])
    expect(collection.traces).toEqual([])
    expect(collection.warnings).not.toContain('malformed_lines')
  })

  it('stages the inspected log prefix when the active file is appended', async () => {
    const now = Date.now()
    const source = path.join(logsDir, `app.${formatLogDate(now)}.log`)
    const inspectedLine = `${JSON.stringify({ timestamp: new Date(now - 1_000).toISOString() })}\n`
    await writeFile(source, inspectedLine)
    const range = { fromMs: now - 86_400_000, toMs: now }
    const collection = await collectDiagnosticSources(range, ALL_SOURCES)

    await appendFile(source, `${JSON.stringify({ timestamp: new Date(now - 500).toISOString() })}\n`)

    const stagedPath = path.join(tempDir, 'appended.jsonl') as AbsoluteFilePath
    await stageSourceCandidate(collection.logs[0], range, stagedPath)
    expect(await readFile(stagedPath, 'utf8')).toBe(inspectedLine)
  })

  it('does not leak an unhandled rejection when staging cannot open its temporary file', async () => {
    const now = Date.now()
    const source = path.join(logsDir, `app.${formatLogDate(now)}.log`)
    const line = `${JSON.stringify({ message: 'x'.repeat(32 * 1024), timestamp: new Date(now - 1_000).toISOString() })}\n`
    await writeFile(source, line)
    const range = { fromMs: now - 86_400_000, toMs: now }
    const collection = await collectDiagnosticSources(range, ALL_SOURCES)
    const unhandledRejections: unknown[] = []
    const handleUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason)
    process.on('unhandledRejection', handleUnhandledRejection)

    try {
      await expect(
        stageSourceCandidate(
          collection.logs[0],
          range,
          path.join(tempDir, 'missing', 'filtered.jsonl') as AbsoluteFilePath
        )
      ).rejects.toMatchObject({ code: 'ENOENT' })
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(unhandledRejections).toEqual([])
    } finally {
      process.off('unhandledRejection', handleUnhandledRejection)
    }
  })

  it('rejects a same-size in-place log rewrite after inspection', async () => {
    const now = Date.now()
    const source = path.join(logsDir, `app.${formatLogDate(now)}.log`)
    const inspectedLine = `${JSON.stringify({ message: 'first', timestamp: new Date(now - 1_000).toISOString() })}\n`
    const rewrittenLine = `${JSON.stringify({ message: 'later', timestamp: new Date(now - 1_000).toISOString() })}\n`
    await writeFile(source, inspectedLine)
    const range = { fromMs: now - 86_400_000, toMs: now }
    const collection = await collectDiagnosticSources(range, ALL_SOURCES)

    await writeFile(source, rewrittenLine)
    const future = new Date(now + 5_000)
    await utimes(source, future, future)

    await expect(
      stageSourceCandidate(collection.logs[0], range, path.join(tempDir, 'rewritten.jsonl') as AbsoluteFilePath)
    ).rejects.toBeInstanceOf(SourceChangedError)
  })

  it('reports only nested crash dumps as an anonymous inventory and never follows symlinks', async () => {
    const now = Date.now()
    const completedDir = path.join(crashDumpsDir, 'completed')
    await mkdir(completedDir)
    const crashPath = path.join(completedDir, 'private-name.dmp')
    await writeFile(crashPath, 'dump')
    await writeFile(path.join(crashDumpsDir, 'settings.dat'), 'must not count')
    if (process.platform !== 'win32') {
      await symlink(crashPath, path.join(crashDumpsDir, 'linked.dmp'))
    }

    const warnings = new Set<DiagnosticWarning>()
    const inventory = await collectCrashDumpInventory({ fromMs: now - 60_000, toMs: now + 60_000 }, warnings)

    expect(inventory.files).toHaveLength(1)
    expect(inventory.totalBytes).toBe(4)
    expect(JSON.stringify(inventory)).not.toContain('private-name')
    expect(JSON.stringify(inventory)).not.toContain('.dmp')
  })

  it.skipIf(process.platform === 'win32')('never follows log, trace file, or trace directory symlinks', async () => {
    const now = Date.now()
    const line = `${JSON.stringify({ timestamp: new Date(now - 1_000).toISOString() })}\n`
    const outsideLog = path.join(workDir, 'outside.log')
    await writeFile(outsideLog, line)
    await symlink(outsideLog, path.join(logsDir, `app.${formatLogDate(now)}.log`))

    const outsideTopic = path.join(workDir, 'outside-topic')
    await mkdir(outsideTopic)
    await writeFile(path.join(outsideTopic, 'trace'), `${JSON.stringify({ startTime: now - 1_000 })}\n`)
    await symlink(outsideTopic, path.join(tracesDir, 'linked-topic'))

    const topicDir = path.join(tracesDir, 'topic')
    await mkdir(topicDir)
    await symlink(path.join(outsideTopic, 'trace'), path.join(topicDir, 'linked-trace'))

    const collection = await collectDiagnosticSources({ fromMs: now - 86_400_000, toMs: now }, ALL_SOURCES)

    expect(collection.logs).toEqual([])
    expect(collection.traces).toEqual([])
  })
})
