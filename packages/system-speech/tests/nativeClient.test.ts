import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { SystemSpeechNativeClient } from '../src/nativeClient'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))

class FakeChild extends EventEmitter {
  stdin = new PassThrough()
  stdout = new PassThrough()
  stderr = new PassThrough()
  kill = vi.fn(() => true)
}

describe('SystemSpeechNativeClient', () => {
  let directory: string
  let helperPath: string
  const spawnMock = vi.mocked(spawn)

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'system-speech-client-'))
    helperPath = join(directory, 'helper')
    await writeFile(helperPath, '#!/bin/sh\n')
    await chmod(helperPath, 0o700)
  })

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  beforeEach(() => {
    spawnMock.mockReset()
  })

  it('returns one successful response and ignores stderr diagnostics', async () => {
    const child = spawnResponse({
      ok: true,
      value: {
        operation: 'transcribe',
        result: { locale: 'zh_CN', text: '本地结果' }
      }
    })
    spawnMock.mockReturnValue(child as unknown as ChildProcessWithoutNullStreams)
    const client = new SystemSpeechNativeClient({ helperPath })

    await expect(
      client.request({ operation: 'transcribe', locale: 'zh-CN', inputPath: '/tmp/input.wav' })
    ).resolves.toEqual({
      operation: 'transcribe',
      result: { locale: 'zh_CN', text: '本地结果' }
    })
  })

  it('normalizes malformed and oversized output', async () => {
    for (const output of ['not json', 'x'.repeat(1_048_577)]) {
      const child = spawnOutput(output)
      spawnMock.mockReturnValueOnce(child as unknown as ChildProcessWithoutNullStreams)
      const client = new SystemSpeechNativeClient({ helperPath })

      await expect(client.request({ operation: 'capabilities', locale: 'zh-CN' })).rejects.toMatchObject({
        code: 'native_helper_failed'
      })
    }
  })

  it('maps a helper error without exposing stderr', async () => {
    const child = spawnResponse({ ok: false, error: { code: 'asset_required', message: 'asset_required' } })
    spawnMock.mockReturnValue(child as unknown as ChildProcessWithoutNullStreams)
    const client = new SystemSpeechNativeClient({ helperPath })

    await expect(
      client.request({ operation: 'transcribe', locale: 'zh-CN', inputPath: '/tmp/input.wav' })
    ).rejects.toMatchObject({ code: 'asset_required', message: 'asset_required' })
  })

  it('terminates then kills an aborted helper', async () => {
    const child = new FakeChild()
    spawnMock.mockReturnValue(child as unknown as ChildProcessWithoutNullStreams)
    const client = new SystemSpeechNativeClient({ helperPath, killGraceMs: 1 })
    const controller = new AbortController()
    const request = client.request({ operation: 'capabilities', locale: 'zh-CN' }, { signal: controller.signal })

    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledOnce())
    controller.abort()
    await expect(request).rejects.toMatchObject({ code: 'cancelled' })
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    await vi.waitFor(() => expect(child.kill).toHaveBeenCalledWith('SIGKILL'))
  })

  function spawnResponse(response: unknown): FakeChild {
    return spawnOutput(JSON.stringify(response), 'private diagnostic')
  }

  function spawnOutput(output: string, stderr = ''): FakeChild {
    const child = new FakeChild()
    child.stdin.once('finish', () => {
      queueMicrotask(() => {
        child.stdout.end(output)
        child.stderr.end(stderr)
        child.emit('close', 0, null)
      })
    })
    return child
  }
})
