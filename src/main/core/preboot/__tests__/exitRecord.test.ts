import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }

let userDataDir: string
let recordFile: string

async function loadModule() {
  vi.resetModules()
  vi.doMock('@logger', () => ({ loggerService: { withContext: () => logger } }))
  return import('../exitRecord')
}

const readRecord = (file: string = recordFile) => JSON.parse(fs.readFileSync(file, 'utf8'))

describe('exitRecord', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    // Keep the module's `exit` hook off the real test process.
    vi.spyOn(process, 'on').mockImplementation(() => process)
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exit-record-'))
    recordFile = path.join(userDataDir, 'last-session.json')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.doUnmock('@logger')
    fs.rmSync(userDataDir, { recursive: true, force: true })
  })

  it('logs nothing about a previous exit on first launch', async () => {
    const { trackProcessExit } = await loadModule()
    trackProcessExit(userDataDir)

    expect(logger.info).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
    expect(readRecord().pid).toBe(process.pid)
  })

  it('refreshes the heartbeat on every interval so the last timestamp is accurate to one interval', async () => {
    const { trackProcessExit, HEARTBEAT_INTERVAL_MS } = await loadModule()
    trackProcessExit(userDataDir)
    const first = readRecord().heartbeatAt

    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS)

    expect(Date.parse(readRecord().heartbeatAt) - Date.parse(first)).toBe(HEARTBEAT_INTERVAL_MS)
  })

  it('reports a graceful exit with its reason on the next launch', async () => {
    const first = await loadModule()
    first.trackProcessExit(userDataDir)
    first.noteExitReason('quit')
    first.recordExit()

    const next = await loadModule()
    next.trackProcessExit(userDataDir)

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('previous exit: graceful (quit)'))
  })

  it('reports an OS shutdown distinctly', async () => {
    const first = await loadModule()
    first.trackProcessExit(userDataDir)
    first.noteExitReason('system-shutdown')
    first.recordExit()

    const next = await loadModule()
    next.trackProcessExit(userDataDir)

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('previous exit: system shutdown'))
  })

  it('scopes the record to the resolved userData profile so independently locked profiles never collide', async () => {
    const first = await loadModule()
    first.trackProcessExit(userDataDir)
    first.noteExitReason('quit')
    first.recordExit()

    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exit-record-other-'))
    try {
      // A second packaged copy with its own userData (and its own
      // single-instance lock) sees no previous exit and writes its own record.
      const other = await loadModule()
      other.trackProcessExit(otherDir)

      expect(logger.info).not.toHaveBeenCalled()
      expect(logger.warn).not.toHaveBeenCalled()
      expect(fs.existsSync(path.join(otherDir, 'last-session.json'))).toBe(true)

      // The first profile's record is untouched by the other profile.
      const next = await loadModule()
      next.trackProcessExit(userDataDir)
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('previous exit: graceful (quit)'))
    } finally {
      fs.rmSync(otherDir, { recursive: true, force: true })
    }
  })

  it('reports a forced exit as forced, not graceful, keeping the requested reason', async () => {
    const first = await loadModule()
    first.trackProcessExit(userDataDir)
    first.noteExitReason('force-exit')
    first.markExitForced()
    first.recordExit()

    const next = await loadModule()
    next.trackProcessExit(userDataDir)

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('previous exit: forced (force-exit)'))
    expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining('graceful'))
  })

  it('reports a shutdown-timeout truncation as forced even when a quit was in progress', async () => {
    const first = await loadModule()
    first.trackProcessExit(userDataDir)
    first.noteExitReason('quit')
    // The shutdown-timeout fuse marks the exit forced, then process.exit(1)
    // reaches the exit hook with the requested reason still noted.
    first.markExitForced()
    first.recordExit('exit(1)')

    const next = await loadModule()
    next.trackProcessExit(userDataDir)

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('previous exit: forced (quit)'))
  })

  it('reports a system-shutdown cleanup cut short by the timeout fuse as forced, keeping the shutdown reason', async () => {
    const first = await loadModule()
    first.trackProcessExit(userDataDir)
    first.noteExitReason('system-shutdown')
    first.markExitForced()
    first.recordExit()

    const next = await loadModule()
    next.trackProcessExit(userDataDir)

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('previous exit: forced (system-shutdown)'))
    expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining('previous exit: system shutdown'))
  })

  it('treats records written before outcomes existed as graceful', async () => {
    fs.writeFileSync(
      recordFile,
      JSON.stringify({
        pid: 1,
        startedAt: '2026-01-01T00:00:00.000Z',
        heartbeatAt: '2026-01-01T00:00:00.000Z',
        memMB: 100,
        exit: { at: '2026-01-01T01:00:00.000Z', reason: 'quit' }
      })
    )
    const { trackProcessExit } = await loadModule()
    trackProcessExit(userDataDir)

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('previous exit: graceful (quit)'))
  })

  it('persists observed system-shutdown intent before teardown and reports an interrupted shutdown', async () => {
    const first = await loadModule()
    first.trackProcessExit(userDataDir)
    first.noteExitReason('system-shutdown')

    // The intent is on disk before any exit marker: termination during async
    // teardown (after the Windows shutdown barrier is released) keeps it.
    expect(readRecord().shutdownIntent).toBe('system-shutdown')

    const next = await loadModule()
    next.trackProcessExit(userDataDir)

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('previous exit: system shutdown interrupted during cleanup')
    )
  })

  it('clears the shutdown intent once the exit marker is written', async () => {
    const first = await loadModule()
    first.trackProcessExit(userDataDir)
    first.noteExitReason('system-shutdown')
    first.recordExit()

    expect(readRecord().shutdownIntent).toBeUndefined()

    const next = await loadModule()
    next.trackProcessExit(userDataDir)

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('previous exit: system shutdown'))
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('reports a session that left no exit marker as killed, with its last heartbeat', async () => {
    const first = await loadModule()
    first.trackProcessExit(userDataDir)
    vi.advanceTimersByTime(first.HEARTBEAT_INTERVAL_MS * 3)
    const lastHeartbeat = readRecord().heartbeatAt

    const next = await loadModule()
    next.trackProcessExit(userDataDir)

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(`previous exit: killed without graceful shutdown (last heartbeat ${lastHeartbeat}`)
    )
  })

  it('treats a truncated record as killed rather than throwing', async () => {
    fs.writeFileSync(recordFile, '{"pid":1,"heartb')
    const { trackProcessExit } = await loadModule()

    expect(() => trackProcessExit(userDataDir)).not.toThrow()
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('killed without graceful shutdown'))
  })

  it('stops heartbeating once the exit marker is written and keeps the first reason', async () => {
    const { trackProcessExit, noteExitReason, recordExit, HEARTBEAT_INTERVAL_MS } = await loadModule()
    trackProcessExit(userDataDir)
    noteExitReason('relaunch')
    recordExit()
    const afterExit = readRecord()

    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 2)
    recordExit('exit(1)')

    expect(readRecord()).toEqual(afterExit)
    expect(afterExit.exit.reason).toBe('relaunch')
  })
})
