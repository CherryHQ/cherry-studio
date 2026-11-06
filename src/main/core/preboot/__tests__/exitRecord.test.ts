import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }

let logsDir: string
let recordFile: string

async function loadModule() {
  vi.resetModules()
  vi.doMock('@logger', () => ({ loggerService: { withContext: () => logger } }))
  vi.doMock('@main/core/paths/constants', () => ({ LOGS_DIR: logsDir }))
  return import('../exitRecord')
}

const readRecord = () => JSON.parse(fs.readFileSync(recordFile, 'utf8'))

describe('exitRecord', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    // Keep the module's `exit` hook off the real test process.
    vi.spyOn(process, 'on').mockImplementation(() => process)
    logsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exit-record-'))
    recordFile = path.join(logsDir, 'last-session.json')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.doUnmock('@logger')
    vi.doUnmock('@main/core/paths/constants')
    fs.rmSync(logsDir, { recursive: true, force: true })
  })

  it('logs nothing about a previous exit on first launch', async () => {
    const { trackProcessExit } = await loadModule()
    trackProcessExit()

    expect(logger.info).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
    expect(readRecord().pid).toBe(process.pid)
  })

  it('refreshes the heartbeat on every interval so the last timestamp is accurate to one interval', async () => {
    const { trackProcessExit, HEARTBEAT_INTERVAL_MS } = await loadModule()
    trackProcessExit()
    const first = readRecord().heartbeatAt

    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS)

    expect(Date.parse(readRecord().heartbeatAt) - Date.parse(first)).toBe(HEARTBEAT_INTERVAL_MS)
  })

  it('reports a graceful exit with its reason on the next launch', async () => {
    const first = await loadModule()
    first.trackProcessExit()
    first.noteExitReason('quit')
    first.recordExit()

    const next = await loadModule()
    next.trackProcessExit()

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('previous exit: graceful (quit)'))
  })

  it('reports an OS shutdown distinctly', async () => {
    const first = await loadModule()
    first.trackProcessExit()
    first.noteExitReason('system-shutdown')
    first.recordExit()

    const next = await loadModule()
    next.trackProcessExit()

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('previous exit: system shutdown'))
  })

  it('reports a session that left no exit marker as killed, with its last heartbeat', async () => {
    const first = await loadModule()
    first.trackProcessExit()
    vi.advanceTimersByTime(first.HEARTBEAT_INTERVAL_MS * 3)
    const lastHeartbeat = readRecord().heartbeatAt

    const next = await loadModule()
    next.trackProcessExit()

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(`previous exit: killed without graceful shutdown (last heartbeat ${lastHeartbeat}`)
    )
  })

  it('treats a truncated record as killed rather than throwing', async () => {
    fs.writeFileSync(recordFile, '{"pid":1,"heartb')
    const { trackProcessExit } = await loadModule()

    expect(() => trackProcessExit()).not.toThrow()
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('killed without graceful shutdown'))
  })

  it('stops heartbeating once the exit marker is written and keeps the first reason', async () => {
    const { trackProcessExit, noteExitReason, recordExit, HEARTBEAT_INTERVAL_MS } = await loadModule()
    trackProcessExit()
    noteExitReason('relaunch')
    recordExit()
    const afterExit = readRecord()

    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 2)
    recordExit('exit(1)')

    expect(readRecord()).toEqual(afterExit)
    expect(afterExit.exit.reason).toBe('relaunch')
  })
})
