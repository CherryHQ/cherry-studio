import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({
  tempRoot: '',
  register: vi.fn(),
  request: vi.fn(),
  stop: vi.fn(),
  withStopped: vi.fn()
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
  mocked.application.getPath.mockImplementation((_key: string, filename?: string) =>
    filename ? `${runtime.tempRoot}/${filename}` : runtime.tempRoot
  )
  return mocked
})

import { BaseService, Phase } from '@main/core/lifecycle'
import { getConditions, getDependencies, getPhase } from '@main/core/lifecycle/decorators'

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
  it('registers the FFmpeg definition in WhenReady after UtilityProcessManager', () => {
    expect(getPhase(MediaFfmpegService)).toBe(Phase.WhenReady)
    expect(getDependencies(MediaFfmpegService)).toContain('UtilityProcessManager')
    expect(runtime.register).toHaveBeenCalledWith(mediaFfmpegProcess)
  })

  it('is available only where a self-contained bundled runtime exists', () => {
    const [condition] = getConditions(MediaFfmpegService)!
    const context = { arch: 'arm64' as const, cpuModel: '', env: process.env }

    expect(condition.matches({ ...context, platform: 'darwin' })).toBe(true)
    expect(condition.matches({ ...context, platform: 'win32' })).toBe(true)
    expect(condition.matches({ ...context, platform: 'linux' })).toBe(false)
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
