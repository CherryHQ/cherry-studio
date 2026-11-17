import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

import { afterEach, describe, expect, it, vi } from 'vitest'

const { spawn, stat } = vi.hoisted(() => ({ spawn: vi.fn(), stat: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn }))
vi.mock('node:fs/promises', () => ({ stat }))

import type { NativeRequest } from '../src/contracts'
import { SystemSpeechNativeClient } from '../src/SystemSpeechNativeClient'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

function windowsHelper() {
  vi.stubGlobal('process', { ...process, platform: 'win32' })
  stat.mockResolvedValue({ isFile: () => true, mode: 0o600 })
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn()
  })
  spawn.mockReturnValue(child)
  return child
}

describe('Windows native client', () => {
  it.each([
    [{ operation: 'probe_asr', locale: 'en-US' }, { locale: 'en-US' }],
    [
      { operation: 'transcribe', locale: 'en-US', inputPath: 'C:\\private\\input.wav' },
      { locale: 'en-US', text: 'private transcript' }
    ]
  ] as const)('validates %j responses and sends ASR paths only over stdin', async (request, result) => {
    const child = windowsHelper()
    let input = ''
    child.stdin.on('data', (chunk) => {
      input += chunk.toString()
    })
    child.stdin.on('finish', () => {
      child.stdout.write(JSON.stringify({ ok: true, value: { operation: request.operation, result } }))
      child.emit('close', 0)
    })
    await expect(new SystemSpeechNativeClient({ helperPath: 'C:\\app\\speech.exe' }).request(request)).resolves.toEqual(
      { operation: request.operation, result }
    )
    expect(JSON.parse(input)).toEqual(request)
    expect(spawn.mock.calls[0][1]).toEqual([])
    expect(spawn.mock.calls[0][2].windowsHide).toBe(true)
  })

  it('accepts a Windows executable without POSIX permissions and keeps text off the command line', async () => {
    const child = windowsHelper()
    const request = {
      operation: 'synthesize' as const,
      voiceId: 'installed-voice',
      text: 'private speech canary',
      outputPath: 'C:\\private\\speech.wav',
      speed: 1.25
    }
    let input = ''
    child.stdin.on('data', (chunk) => {
      input += chunk.toString()
    })
    const result = { ...request, sampleRate: 16000, channels: 1, frameCount: 16000 }
    child.stdin.on('finish', () => {
      child.stdout.write(
        JSON.stringify({
          ok: true,
          value: {
            operation: 'synthesize',
            result: {
              voiceId: result.voiceId,
              outputPath: result.outputPath,
              sampleRate: result.sampleRate,
              channels: result.channels,
              frameCount: result.frameCount
            }
          }
        })
      )
      child.emit('close', 0)
    })

    await expect(
      new SystemSpeechNativeClient({ helperPath: 'C:\\app\\speech.exe' }).request(request)
    ).resolves.toMatchObject({
      operation: 'synthesize',
      result: { voiceId: request.voiceId, outputPath: request.outputPath, frameCount: 16000 }
    })
    expect(JSON.parse(input)).toEqual(request)
    expect(spawn.mock.calls[0]).toEqual([
      'C:\\app\\speech.exe',
      [],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
    ])
  })

  it.each([
    ['cancelled', { operation: 'probe_asr', locale: 'en-US' }],
    ['timeout', { operation: 'probe_asr', locale: 'en-US' }],
    ['cancelled', { operation: 'transcribe', locale: 'en-US', inputPath: 'C:\\private\\input.wav' }],
    ['timeout', { operation: 'transcribe', locale: 'en-US', inputPath: 'C:\\private\\input.wav' }]
  ] satisfies [string, NativeRequest][])(
    'waits for Windows process close before reporting %s for %j',
    async (code, request) => {
      const child = windowsHelper()
      const controller = new AbortController()
      let settled = false
      const pending = new SystemSpeechNativeClient({
        helperPath: 'C:\\app\\speech.exe',
        timeoutMs: code === 'timeout' ? 20 : 1000
      })
        .request(request, { signal: controller.signal })
        .catch((error: unknown) => {
          settled = true
          return error
        })
      await vi.waitFor(() => expect(child.stdin.writableEnded).toBe(true))
      child.stderr.write('private speech canary')
      if (code === 'cancelled') controller.abort(new Error('private speech canary'))
      await vi.waitFor(() => expect(child.kill).toHaveBeenCalled())
      expect(settled).toBe(false)
      child.emit('close', null)
      const error = await pending
      expect(error).toMatchObject({ code, message: code })
      expect((error as Error).cause).toBeUndefined()
    }
  )
})
