import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, it, vi } from 'vitest'

import { runtimeId } from '@cherrystudio/agent-runtime'

import { createClaudeCodeRuntime } from '../src'
import { confirmed, inputId } from './nativeFixture'
import { wireProcess } from './wireFixture'

it.each([true, false])('confirms shutdown only after SDK escalation actually exits the process: %s', async (exits) => {
  const directory = await mkdtemp(join(tmpdir(), 'cherry-claude-shutdown-'))
  const wire = wireProcess()
  wire.process.stdin.removeAllListeners('finish')
  wire.process.kill = (signal) => {
    if (exits && signal === 'SIGKILL') setTimeout(wire.exit, 200)
    return true
  }
  const runtime = createClaudeCodeRuntime({ backendId: runtimeId<'backend'>('shutdown'), configDir: directory })
  try {
    const root = confirmed(
      await runtime.create({ cwd: directory, env: {}, spawnClaudeCodeProcess: () => wire.process })
    )
    confirmed(await root.claude.supportedCommands())
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let settled = false
    const closing = runtime.shutdown().then((result) => {
      settled = true
      return result
    })
    await vi.advanceTimersByTimeAsync(5000)
    expect(settled).toBe(false)
    expect(wire.process.exitCode).toBeNull()
    await vi.advanceTimersByTimeAsync(5000)
    const result = await closing
    if (exits) {
      expect(wire.process.exitCode).toBe(0)
      expect(result.status).toBe('confirmed')
    } else {
      expect(result).toMatchObject({ status: 'unknown', error: { code: 'process-exit-unconfirmed' } })
      expect(await root.input!.submit({ inputId: inputId(), text: 'After stop', whenBusy: 'steer' })).toMatchObject({
        status: 'rejected',
        error: { code: 'closed' }
      })
      wire.exit()
      confirmed(await runtime.shutdown())
    }
  } finally {
    vi.useRealTimers()
    wire.exit()
    await runtime.shutdown()
    await rm(directory, { recursive: true, force: true })
  }
})
