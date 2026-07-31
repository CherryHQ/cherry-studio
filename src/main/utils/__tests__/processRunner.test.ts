import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const crossSpawnMock = vi.hoisted(() => vi.fn())

vi.mock('cross-spawn', () => ({ default: crossSpawnMock }))

import { executeCommand } from '../processRunner'

function createChildProcess() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
  }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  return child
}

describe('executeCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('captures stdout by default', async () => {
    const child = createChildProcess()
    crossSpawnMock.mockReturnValue(child as unknown as ChildProcess)

    const result = executeCommand('example', [], { env: {} })
    child.stdout.emit('data', Buffer.from('command output'))
    child.emit('close', 0)

    await expect(result).resolves.toBe('command output')
  })

  it('discards stdout when capture is explicitly disabled', async () => {
    const child = createChildProcess()
    crossSpawnMock.mockReturnValue(child as unknown as ChildProcess)

    const result = executeCommand('example', [], { capture: false, env: {} })
    child.stdout.emit('data', Buffer.from('command output'))
    child.emit('close', 0)

    await expect(result).resolves.toBe('')
  })
})
