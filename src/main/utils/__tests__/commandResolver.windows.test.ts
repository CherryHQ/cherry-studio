import { spawn } from 'child_process'
import { EventEmitter } from 'events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('child_process')
vi.mock('@main/core/platform', () => ({ isWin: true }))

const { findCommandInShellEnv } = await import('../commandResolver')

function createMockChildProcess() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    kill: ReturnType<typeof vi.fn>
  }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn()
  return child
}

describe('findCommandInShellEnv on Windows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves the npx.cmd launcher installed by Node.js', async () => {
    const child = createMockChildProcess()
    vi.mocked(spawn).mockReturnValue(child as never)

    const result = findCommandInShellEnv('npx', { PATH: 'C:\\Program Files\\nodejs' })
    child.stdout.emit('data', 'C:\\Program Files\\nodejs\\npx.cmd\r\n')
    child.emit('close', 0)

    await expect(result).resolves.toBe('C:\\Program Files\\nodejs\\npx.cmd')
  })

  it('prefers an executable when where returns both .cmd and .exe', async () => {
    const child = createMockChildProcess()
    vi.mocked(spawn).mockReturnValue(child as never)

    const result = findCommandInShellEnv('tool', { PATH: 'C:\\Tools' })
    child.stdout.emit('data', 'C:\\Tools\\tool.cmd\r\nC:\\Tools\\tool.exe\r\n')
    child.emit('close', 0)

    await expect(result).resolves.toBe('C:\\Tools\\tool.exe')
  })
})
