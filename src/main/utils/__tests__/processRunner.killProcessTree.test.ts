import type * as ChildProcessModule from 'node:child_process'
import type { ChildProcess } from 'node:child_process'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// killProcessTree reads `isWin` at call time, so a getter lets each test flip the
// platform without re-importing the module.
const platform = vi.hoisted(() => ({ isWin: false }))
vi.mock('@main/core/platform', () => ({
  get isWin() {
    return platform.isWin
  },
  isMac: false,
  isLinux: false,
  isDev: false,
  isPortable: false
}))

const execFileMock = vi.hoisted(() => vi.fn())
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcessModule>()
  return { ...actual, execFile: execFileMock }
})

// processRunner imports these at module scope; stub so importing it doesn't pull in Electron.
vi.mock('@application', () => ({ application: { getPath: () => '/mock' } }))
vi.mock('../shellEnv', () => ({ getShellEnv: vi.fn() }))

const { killProcessTree } = await import('../processRunner')

type FakeChild = { pid?: number; kill: ReturnType<typeof vi.fn> }
const makeChild = (pid?: number): ChildProcess => ({ pid, kill: vi.fn() }) as unknown as ChildProcess

// Stub process.kill so tests never signal a real process group; default succeeds.
const mockProcessKill = () => vi.spyOn(process, 'kill').mockReturnValue(true)

describe('killProcessTree', () => {
  let processKillSpy!: ReturnType<typeof mockProcessKill>

  beforeEach(() => {
    vi.clearAllMocks()
    platform.isWin = false
    processKillSpy = mockProcessKill()
  })

  afterEach(() => {
    processKillSpy.mockRestore()
  })

  it('signals the whole process group via a negative PID on non-Windows platforms', () => {
    const child = makeChild(4242)
    killProcessTree(child)
    expect(processKillSpy).toHaveBeenCalledWith(-4242, 'SIGTERM')
    expect((child as unknown as FakeChild).kill).not.toHaveBeenCalled()
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('falls back to child.kill() when the process group signal fails on non-Windows platforms', () => {
    processKillSpy.mockImplementation(() => {
      throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' })
    })
    const child = makeChild(4242)
    killProcessTree(child)
    expect(processKillSpy).toHaveBeenCalledWith(-4242, 'SIGTERM')
    expect((child as unknown as FakeChild).kill).toHaveBeenCalledTimes(1)
  })

  it('kills directly when a non-Windows child has no pid', () => {
    const child = makeChild(undefined)
    killProcessTree(child)
    expect(processKillSpy).not.toHaveBeenCalled()
    expect((child as unknown as FakeChild).kill).toHaveBeenCalledTimes(1)
  })

  it('force-kills the whole tree via taskkill /T /F on Windows', () => {
    platform.isWin = true
    const child = makeChild(4242)
    killProcessTree(child)
    expect(execFileMock).toHaveBeenCalledWith('taskkill', ['/PID', '4242', '/T', '/F'], expect.any(Function))
    expect((child as unknown as FakeChild).kill).not.toHaveBeenCalled()
  })

  it('falls back to child.kill() when taskkill reports an error on Windows', () => {
    platform.isWin = true
    const child = makeChild(4242)
    killProcessTree(child)
    const callback = execFileMock.mock.calls[0][2] as (error: Error | null) => void
    callback(new Error('ERROR: The process 4242 not found.'))
    expect((child as unknown as FakeChild).kill).toHaveBeenCalledTimes(1)
  })

  it('kills directly when a Windows child has no pid', () => {
    platform.isWin = true
    const child = makeChild(undefined)
    killProcessTree(child)
    expect(execFileMock).not.toHaveBeenCalled()
    expect((child as unknown as FakeChild).kill).toHaveBeenCalledTimes(1)
  })
})
