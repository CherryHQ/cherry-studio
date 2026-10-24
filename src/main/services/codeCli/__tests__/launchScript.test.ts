import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import type fsDefault from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// One-shot fault injection for the two cleanup-failure paths; a fault destroys
// itself on first call, everything else passes through to the real filesystem.
const fsFaults = vi.hoisted(() => ({
  chmodSync: null as null | (() => void),
  unlinkSync: null as null | (() => void)
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof fsDefault>()
  return {
    ...actual,
    default: {
      ...actual,
      chmodSync: (...args: [string, number]): void => {
        if (fsFaults.chmodSync) return fsFaults.chmodSync()
        actual.chmodSync(...args)
      },
      unlinkSync: (scriptPath: string): void => {
        if (fsFaults.unlinkSync) return fsFaults.unlinkSync()
        actual.unlinkSync(scriptPath)
      }
    }
  }
})

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

// Module-level singletons must not leak across cases — import fresh each
// time; the file-level @application mock factory reads tempDir live.
const importFresh = async () => {
  vi.resetModules()
  return import('../launchScript')
}

describe('writeLaunchScript', () => {
  // Cases may repoint `tempDir` at a nested path; always remove the mkdtemp root.
  let tempDirRoot: string
  // Listener count before the case, so afterEach removes only what it added.
  let exitListenerBaseline = 0

  beforeEach(() => {
    tempDirRoot = mkdtempSync(path.join(tmpdir(), 'launch-script-test-'))
    tempDir = tempDirRoot
    fsFaults.chmodSync = null
    fsFaults.unlinkSync = null
    exitListenerBaseline = process.listeners('exit').length
  })

  afterEach(() => {
    vi.useRealTimers()
    // Each importFresh registers a fresh exit handler; drop the ones this
    // case added so the suite does not pile up process listeners.
    for (const handler of process.listeners('exit').slice(exitListenerBaseline)) {
      process.off('exit', handler)
    }
    rmSync(tempDirRoot, { recursive: true, force: true })
  })

  it('creates the script with exact body, 0600 mode, and launch_<tool>_<ts>_<rand> naming', async () => {
    const { writeLaunchScript } = await importFresh()
    const body = '#!/bin/sh\ncd /tmp && clear\n'

    const scriptPath = writeLaunchScript('qwen-code', body, '.sh')

    expect(path.basename(scriptPath)).toMatch(/^launch_qwen-code_\d+_[0-9a-f]{8}\.sh$/)
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

  it('never reuses a path when two launches of one tool land on the same millisecond', async () => {
    vi.useFakeTimers() // freezes Date.now
    const { writeLaunchScript } = await importFresh()

    const p1 = writeLaunchScript('qwen-code', 'body1', '.sh')
    const p2 = writeLaunchScript('qwen-code', 'body2', '.sh')

    expect(p1).not.toBe(p2)
    expect(readFileSync(p1, 'utf8')).toBe('body1')
    expect(readFileSync(p2, 'utf8')).toBe('body2')
  })

  it('keeps a script exit-tracked when the timed deletion fails, so exit retries it', async () => {
    vi.useFakeTimers()
    fsFaults.unlinkSync = () => {
      fsFaults.unlinkSync = null // one-shot: the exit-handler retry must succeed
      throw new Error('EPERM: file is locked')
    }
    const { writeLaunchScript } = await importFresh()

    const scriptPath = writeLaunchScript('qwen-code', 'body', '.sh')

    vi.advanceTimersByTime(60_000)
    // The timed deletion failed; the file must survive, pending an exit retry.
    expect(existsSync(scriptPath)).toBe(true)

    const handler = process.listeners('exit').at(-1) as () => void
    handler()
    expect(existsSync(scriptPath)).toBe(false)
  })

  it('leaves no partial file behind when the post-write chmod fails', async () => {
    fsFaults.chmodSync = () => {
      throw new Error('EIO')
    }
    const { writeLaunchScript } = await importFresh()

    expect(() => writeLaunchScript('qwen-code', 'body', '.sh')).toThrow(/Failed to create launch script/)
    // A partially written script must not survive with default permissions.
    expect(readdirSync(tempDir)).toHaveLength(0)
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
