import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => loggerMock
  }
}))

// The module reads the temp dir through the path registry; point it at a real
// throwaway directory so assertions run against the real filesystem.
let tempDir: string
vi.mock('@application', () => ({
  application: {
    getPath: vi.fn(() => tempDir)
  }
}))

// Module-level singletons (pending-cleanups set, exit-handler flag) must not
// leak across test cases — re-import a fresh module instance per test.
const importFresh = async () => {
  vi.resetModules()
  vi.doUnmock('@application')
  vi.doMock('@application', () => ({ application: { getPath: () => tempDir } }))
  return import('../launchScript')
}

describe('writeLaunchScript', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'launch-script-test-'))
  })

  afterEach(() => {
    vi.useRealTimers()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('creates the script with exact body, 0600 mode, and launch_<tool>_<ts> naming', async () => {
    const { writeLaunchScript } = await importFresh()
    const body = '#!/bin/sh\ncd /tmp && clear\n'

    const scriptPath = writeLaunchScript('qwen-code', body, '.sh')

    expect(path.basename(scriptPath)).toMatch(/^launch_qwen-code_\d+\.sh$/)
    expect(existsSync(scriptPath)).toBe(true)
    expect(readFileSync(scriptPath, 'utf8')).toBe(body)
    expect(statSync(scriptPath).mode & 0o777).toBe(0o600)
  })

  it('creates the temp dir when missing and supports .bat extension', async () => {
    const nested = path.join(tempDir, 'missing', 'cli')
    tempDir = nested
    const { writeLaunchScript } = await importFresh()

    const scriptPath = writeLaunchScript('claude-code', '@echo off', '.bat')

    expect(existsSync(scriptPath)).toBe(true)
    expect(path.extname(scriptPath)).toBe('.bat')
  })

  it('registers exactly one exit handler across multiple launches and cleans all pending files on exit', async () => {
    const { writeLaunchScript } = await importFresh()
    const before = process.listenerCount('exit')

    const p1 = writeLaunchScript('qwen-code', 'body1', '.sh')
    const p2 = writeLaunchScript('claude-code', 'body2', '.sh')

    expect(process.listenerCount('exit')).toBe(before + 1)
    // Drive the registered handler the way a real 'exit' event would.
    const handler = process.listeners('exit').at(-1) as () => void
    handler()
    expect(existsSync(p1)).toBe(false)
    expect(existsSync(p2)).toBe(false)
  })

  it('deletes the script 60s after creation', async () => {
    vi.useFakeTimers()
    const { writeLaunchScript } = await importFresh()

    const scriptPath = writeLaunchScript('qwen-code', 'body', '.sh')
    expect(existsSync(scriptPath)).toBe(true)

    vi.advanceTimersByTime(60_000)
    expect(existsSync(scriptPath)).toBe(false)
  })

  it('throws and registers no exit handler when the temp dir is unwritable', async () => {
    const readOnly = path.join(tempDir, 'readonly')
    mkdirSync(readOnly)
    chmodSync(readOnly, 0o500)
    tempDir = readOnly
    const before = process.listenerCount('exit')

    const { writeLaunchScript } = await importFresh()

    expect(() => writeLaunchScript('qwen-code', 'body', '.sh')).toThrow(/Failed to create launch script/)
    expect(process.listenerCount('exit')).toBe(before)
  })
})
