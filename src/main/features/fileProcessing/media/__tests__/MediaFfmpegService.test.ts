import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import type * as FsPromises from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({
  tempRoot: '',
  register: vi.fn(),
  request: vi.fn(),
  stop: vi.fn(),
  withStopped: vi.fn(),
  mkdtempGate: null as null | { entered: () => void; release: Promise<void> }
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const mocked = mockApplicationFactory()
  mocked.application.get.mockImplementation((name: string) => {
    if (name === 'UtilityProcessManager') {
      return {
        register: runtime.register,
        client: () => ({ request: runtime.request, stop: runtime.stop, withStopped: runtime.withStopped })
      }
    }
    throw new Error(`Unexpected service: ${name}`)
  })
  mocked.application.getPath.mockImplementation((key: string, filename?: string) => {
    if (key === 'app.temp') return filename ? join(runtime.tempRoot, filename) : runtime.tempRoot
    const bases: Record<string, string> = {
      'cherry.bin': join(runtime.tempRoot, 'bin'),
      'cherry.bin.ffmpeg.bin': join(runtime.tempRoot, 'bin', 'ffmpeg', 'bin'),
      'cherry.bin.ffmpeg.lib': join(runtime.tempRoot, 'bin', 'ffmpeg', 'lib')
    }
    const base = bases[key]
    if (!base) throw new Error(`unexpected path key ${key}`)
    return filename ? join(base, filename) : base
  })
  return mocked
})

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof FsPromises>('node:fs/promises')
  return {
    ...actual,
    mkdtemp: (async (prefix: string) => {
      const gate = runtime.mkdtempGate
      if (gate) {
        gate.entered()
        await gate.release
      }
      return actual.mkdtemp(prefix)
    }) as typeof actual.mkdtemp
  }
})

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'
import { getConditions } from '@main/core/lifecycle/decorators'

import { mediaFfmpegCommandEnv } from '../mediaFfmpegLoader'
import { mediaFfmpegProcess } from '../mediaFfmpegProcess'
import { MediaFfmpegService } from '../MediaFfmpegService'

let service: MediaFfmpegService | undefined

beforeEach(async () => {
  BaseService.resetInstances()
  runtime.tempRoot = mkdtempSync(join(tmpdir(), 'cherry-media-service-test-'))
  runtime.register.mockReset()
  runtime.request.mockReset()
  runtime.stop.mockReset().mockResolvedValue(undefined)
  runtime.withStopped.mockReset()
  runtime.mkdtempGate = null
  service = new MediaFfmpegService()
  await service._doInit()
})

afterEach(async () => {
  if (service && !service.isStopped && !service.isDestroyed) await service._doStop()
  rmSync(runtime.tempRoot, { recursive: true, force: true })
  service = undefined
  BaseService.resetInstances()
})

describe('MediaFfmpegService lifecycle', () => {
  it('is available where a bundled FFmpeg runtime exists', () => {
    const [condition] = getConditions(MediaFfmpegService)!
    const context = { arch: 'arm64' as const, cpuModel: '', env: process.env }

    expect(condition.matches({ ...context, platform: 'darwin' })).toBe(true)
    expect(condition.matches({ ...context, platform: 'win32' })).toBe(true)
    expect(condition.matches({ ...context, platform: 'linux' })).toBe(true)
    expect(condition.matches({ ...context, platform: 'aix' })).toBe(false)
  })

  it('resolves the Linux tree and isolates its loader path from the utility-process env', () => {
    expect(mediaFfmpegProcess.createEnv).toBeUndefined()
    const original = Object.getOwnPropertyDescriptor(process, 'platform')!
    Object.defineProperty(process, 'platform', { value: 'linux' })
    try {
      vi.mocked(application.getPath).mockClear()
      const init = mediaFfmpegProcess.createInitData?.()
      if (!init || init instanceof Promise) throw new Error('expected sync init data')
      expect(init.ffmpegPath).toBe(join(runtime.tempRoot, 'bin', 'ffmpeg', 'bin', 'ffmpeg'))
      expect(init.ffprobePath).toBe(join(runtime.tempRoot, 'bin', 'ffmpeg', 'bin', 'ffprobe'))
      expect(init.linuxLibraryDir).toBe(join(runtime.tempRoot, 'bin', 'ffmpeg', 'lib'))
      expect(vi.mocked(application.getPath).mock.calls).toEqual([
        ['cherry.bin.ffmpeg.bin', 'ffmpeg'],
        ['cherry.bin.ffmpeg.bin', 'ffprobe'],
        ['cherry.bin.ffmpeg.lib']
      ])
      const env = mediaFfmpegCommandEnv(init.linuxLibraryDir, {
        PATH: '/usr/bin',
        LD_LIBRARY_PATH: '/usr/lib:/opt/lib',
        LD_PRELOAD: '/tmp/inject.so',
        DYLD_LIBRARY_PATH: '/opt/darwin',
        HOME: '/home/a'
      })
      expect(env).toMatchObject({ PATH: '/usr/bin', HOME: '/home/a', LD_LIBRARY_PATH: init.linuxLibraryDir })
      expect(env).not.toHaveProperty('LD_PRELOAD')
      expect(env).not.toHaveProperty('DYLD_LIBRARY_PATH')
      expect(env!.LD_LIBRARY_PATH).not.toContain('/usr/lib')
    } finally {
      Object.defineProperty(process, 'platform', original)
    }
  })

  it('keeps Darwin and Windows executables flat with no loader env', () => {
    const original = Object.getOwnPropertyDescriptor(process, 'platform')!
    try {
      for (const platform of ['darwin', 'win32'] as const) {
        Object.defineProperty(process, 'platform', { value: platform })
        vi.mocked(application.getPath).mockClear()
        const init = mediaFfmpegProcess.createInitData?.()
        if (!init || init instanceof Promise) throw new Error('expected sync init data')
        const suffix = platform === 'win32' ? '.exe' : ''
        expect(init.ffmpegPath).toBe(join(runtime.tempRoot, 'bin', `ffmpeg${suffix}`))
        expect(init.ffprobePath).toBe(join(runtime.tempRoot, 'bin', `ffprobe${suffix}`))
        expect(init.linuxLibraryDir).toBeUndefined()
        expect(vi.mocked(application.getPath).mock.calls).toEqual([
          ['cherry.bin', `ffmpeg${suffix}`],
          ['cherry.bin', `ffprobe${suffix}`]
        ])
        expect(mediaFfmpegCommandEnv(init.linuxLibraryDir, { LD_LIBRARY_PATH: '/usr/lib' })).toBeUndefined()
      }
    } finally {
      Object.defineProperty(process, 'platform', original)
    }
  })

  it('waits for utility-process stop and rejects queued work after stopping', async () => {
    const stop = Promise.withResolvers<void>()
    runtime.stop.mockReturnValue(stop.promise)
    const stopping = service!._doStop()
    const queued = service!.probe({ filePath: '/media.wav' })

    await Promise.resolve()
    expect(runtime.stop).toHaveBeenCalledOnce()
    expect(runtime.request).not.toHaveBeenCalled()
    stop.resolve()
    await stopping
    await expect(queued).rejects.toThrow('inactive lifecycle generation')
  })

  it('does not replay pre-stop queued work into a restarted worker', async () => {
    const first = Promise.withResolvers<unknown>()
    runtime.request.mockImplementationOnce(() => first.promise)
    const firstProbe = service!.probe({ filePath: '/first.wav' })
    const queued = service!.probe({ filePath: '/queued.wav' })
    await vi.waitFor(() => expect(runtime.request).toHaveBeenCalledOnce())

    await service!._doStop()
    await service!._doInit()
    first.reject(new Error('stopped worker'))

    await expect(firstProbe).rejects.toThrow('stopped worker')
    await expect(queued).rejects.toThrow('inactive lifecycle generation')
    expect(runtime.request).toHaveBeenCalledOnce()
  })

  it.each(['stop', 'restart'] as const)(
    'does not dispatch a worker when %s overlaps temp allocation',
    async (transition) => {
      const entered = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      runtime.mkdtempGate = { entered: () => entered.resolve(), release: release.promise }
      const pending = service!.probe({ filePath: '/during-alloc.wav' })
      try {
        await entered.promise
        await service!._doStop()
        if (transition === 'restart') await service!._doInit()
        release.resolve()

        await expect(pending).rejects.toThrow('inactive lifecycle generation')
        expect(runtime.request).not.toHaveBeenCalled()
        const leftovers = readdirSync(runtime.tempRoot).filter((entry) => entry.startsWith('media-ffmpeg-'))
        expect(leftovers).toEqual([])
      } finally {
        release.resolve()
        runtime.mkdtempGate = null
      }
    }
  )
})

describe('MediaFfmpegService dispatch', () => {
  it('serializes requests and keeps PID registry plumbing out of caller input', async () => {
    const first = Promise.withResolvers<unknown>()
    runtime.request
      .mockImplementationOnce(async (_method, input) => {
        expect(input).toMatchObject({ filePath: '/first.wav' })
        expect(input.pidRegistryPath).toMatch(/active-child\.pid$/)
        return first.promise
      })
      .mockResolvedValueOnce({ hasAudio: true, hasVideo: false, durationMs: 1, mime: 'audio/wav', kind: 'audio' })

    const firstProbe = service!.probe({ filePath: '/first.wav' })
    const secondProbe = service!.probe({ filePath: '/second.wav' })
    await vi.waitFor(() => expect(runtime.request).toHaveBeenCalledTimes(1))

    first.resolve({ hasAudio: true, hasVideo: false, durationMs: 1, mime: 'audio/wav', kind: 'audio' })
    await expect(firstProbe).resolves.toMatchObject({ kind: 'audio' })
    await expect(secondProbe).resolves.toMatchObject({ kind: 'audio' })
    expect(runtime.request).toHaveBeenNthCalledWith(
      2,
      'probe',
      expect.objectContaining({ filePath: '/second.wav', pidRegistryPath: expect.any(String) }),
      { signal: undefined }
    )
  })

  it('dispatches scene detection through the utility-process contract', async () => {
    runtime.request.mockResolvedValue({ changes: [] })
    await expect(
      service!.detectSceneChanges({
        filePath: '/clip.mp4',
        durationMs: 1_000,
        sampleFps: 8,
        scoreThreshold: 0.3,
        scanEdgePx: 160,
        maxCandidates: 16
      })
    ).resolves.toEqual({ changes: [] })
    expect(runtime.request).toHaveBeenCalledWith(
      'detectSceneChanges',
      expect.objectContaining({ filePath: '/clip.mp4', sampleFps: 8, pidRegistryPath: expect.any(String) }),
      { signal: undefined }
    )
  })

  it.each(['worker crash', 'caller abort'])('waits for an orphaned child to exit after %s', async (failureMode) => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    const exited = waitForExit(child)
    const failure = new Error(failureMode)
    runtime.request.mockImplementation(async (_method, input, options) => {
      writeFileSync(input.pidRegistryPath, `${child.pid}\n`, 'utf8')
      if (failureMode === 'worker crash') throw failure
      return await new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
      })
    })
    const controller = new AbortController()

    try {
      const pending = service!.probe({ filePath: '/media.wav' }, controller.signal)
      await vi.waitFor(() => expect(runtime.request).toHaveBeenCalledOnce())
      if (failureMode === 'caller abort') controller.abort(failure)

      await expect(pending).rejects.toBe(failure)
      expect(() => process.kill(child.pid!, 0)).toThrow()
      await exited
      if (process.platform === 'win32') expect(child.exitCode).not.toBeNull()
      else expect(child.signalCode).toBe('SIGKILL')
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }
  })
})

function waitForExit(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once('exit', () => resolve())
    child.once('error', reject)
  })
}
