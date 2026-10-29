import { readFileSync } from 'node:fs'
import path from 'node:path'

import { MockApplicationUtils } from '@test-mocks/main/application'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '@main/core/lifecycle'
import { assertQuadrants } from '@main/utils/__tests__/heifFixture'
import * as imageUtils from '@main/utils/image'
import { fileErrorCodes } from '@shared/ipc/errors/file'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import { HeifRenditionService } from '../HeifRenditionService'

const bytes = readFileSync('tests/fixtures/heif/quadrants.heic')
const fakePng = { content: new Uint8Array([137, 80, 78, 71]), mediaType: 'image/png' as const, width: 1, height: 1 }
let service: HeifRenditionService
beforeEach(() => {
  BaseService.resetInstances()
  service = new HeifRenditionService()
})
afterEach(async () => {
  await service._doStop()
  MockApplicationUtils.resetServices()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

it('decodes real bytes and reuses the encoded result by SHA-256 content', async () => {
  const first = await service.getRendition({ kind: 'bytes', content: bytes })
  const second = await service.getRendition({ kind: 'bytes', content: Uint8Array.from(bytes) })
  await assertQuadrants(first.content)
  expect(first.mediaType).toBe('image/png')
  expect(Buffer.from(first.content).subarray(0, 4).toString('hex')).toBe('89504e47')
  expect(first.revision).toMatch(/^heif-png-v1:[a-f0-9]{64}$/)
  expect(second.content).toBe(first.content)
})

it('does not reuse a cached result for different bytes of identical size', async () => {
  vi.spyOn(imageUtils, 'transcodeHeifToPng').mockImplementation(async (input) => ({ ...fakePng, width: input[0] }))
  const a = await service.getRendition({ kind: 'bytes', content: new Uint8Array([1, 2]) })
  const b = await service.getRendition({ kind: 'bytes', content: new Uint8Array([2, 1]) })
  expect([a.width, b.width]).toEqual([1, 2])
  expect(a.revision).not.toBe(b.revision)
})

it('removes rejected work so an identical request can retry', async () => {
  vi.spyOn(imageUtils, 'transcodeHeifToPng')
    .mockRejectedValueOnce(new IpcError(fileErrorCodes.HEIF_INVALID))
    .mockResolvedValueOnce(fakePng)
  await expect(service.getRendition({ kind: 'bytes', content: bytes })).rejects.toMatchObject({
    code: 'FILE_HEIF_INVALID'
  })
  await expect(service.getRendition({ kind: 'bytes', content: bytes })).resolves.toMatchObject(fakePng)
})

it('rejects oversized input before decoding and preserves the pixel-limit domain error', async () => {
  await expect(
    service.getRendition({ kind: 'bytes', content: new Uint8Array(64 * 1024 * 1024 + 1) })
  ).rejects.toMatchObject({ code: 'FILE_HEIF_TOO_LARGE', data: { limit: 'input_bytes' } })
  vi.spyOn(imageUtils, 'transcodeHeifToPng').mockImplementation(async () => {
    imageUtils.validateHeifDimensions(8000, 8000)
    return fakePng
  })
  await expect(service.getRendition({ kind: 'bytes', content: bytes })).rejects.toMatchObject({
    code: 'FILE_HEIF_TOO_LARGE',
    data: { limit: 'pixels' }
  })
})

it('uses bounded versioned entry reads and rejects incomplete snapshots', async () => {
  const entryId = '019606a0-0000-7000-8000-000000000001'
  const readChunk = vi.fn().mockResolvedValue({ content: bytes, version: { size: bytes.length, mtime: 2 } })
  MockApplicationUtils.setService('FileManager', {
    getVersion: async () => ({ size: bytes.length, mtime: 1 }),
    readChunk
  })
  const result = await service.getRendition({ kind: 'entry', entryId })
  expect(result.sourceVersion).toEqual({ size: bytes.length, mtime: 2 })
  expect(readChunk).toHaveBeenCalledWith(entryId, 0, bytes.length)
  readChunk.mockResolvedValueOnce({ content: bytes.subarray(0, 1), version: { size: bytes.length, mtime: 2 } })
  await expect(service.getRendition({ kind: 'entry', entryId })).rejects.toMatchObject({
    code: 'FILE_HEIF_READ_FAILED'
  })
})

it('reads the path arm with its current source version', async () => {
  const result = await service.getRendition({
    kind: 'path',
    path: AbsoluteFilePathSchema.parse(path.resolve('tests/fixtures/heif/quadrants.heic'))
  })
  expect(result.sourceVersion?.size).toBe(bytes.length)
  expect(result.width).toBe(96)
})

describe('admission and cancellation', () => {
  it('keeps one conversion active, coalesces consumers, and admits at most eight waiting', async () => {
    let release!: () => void
    let active = 0,
      maximum = 0
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.spyOn(imageUtils, 'transcodeHeifToPng').mockImplementation(async () => {
      active++
      maximum = Math.max(maximum, active)
      await blocked
      active--
      return fakePng
    })
    const signal = new AbortController()
    const cancelled = service.getRendition({ kind: 'bytes', content: bytes }, signal.signal)
    const shared = service.getRendition({ kind: 'bytes', content: bytes })
    await vi.waitFor(() => expect(active).toBe(1))
    signal.abort(new Error('consumer cancelled'))
    await expect(cancelled).rejects.toThrow('consumer cancelled')
    const waiting = Array.from({ length: 8 }, (_, i) =>
      service.getRendition({ kind: 'bytes', content: new Uint8Array([i]) })
    )
    await expect(service.getRendition({ kind: 'bytes', content: new Uint8Array([99]) })).rejects.toMatchObject({
      code: 'FILE_HEIF_BUSY'
    })
    release()
    expect((await shared).mediaType).toBe('image/png')
    await Promise.all(waiting)
    expect(maximum).toBe(1)
  })

  it('retains the active slot after a soft timeout until decoding actually finishes', async () => {
    vi.useFakeTimers()
    let release!: (value: imageUtils.HeifPng) => void
    let starts = 0
    vi.spyOn(imageUtils, 'transcodeHeifToPng').mockImplementation(() => {
      starts++
      return new Promise((resolve) => {
        release = resolve
      })
    })
    const first = service.getRendition({ kind: 'bytes', content: bytes })
    const rejected = expect(first).rejects.toMatchObject({ code: 'FILE_HEIF_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(30_000)
    await rejected
    const second = service.getRendition({ kind: 'bytes', content: new Uint8Array([1]) })
    const stopped = expect(second).rejects.toMatchObject({ code: 'FILE_HEIF_UNAVAILABLE' })
    await Promise.resolve()
    expect(starts).toBe(1)
    await service._doStop()
    release(fakePng)
    await stopped
  })
})

it('bounds retained waiting inputs to 128 MiB even when the count limit has room', async () => {
  let release!: (value: imageUtils.HeifPng) => void
  vi.spyOn(imageUtils, 'transcodeHeifToPng')
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        })
    )
    .mockResolvedValue(fakePng)
  const active = service.getRendition({ kind: 'bytes', content: new Uint8Array([99]) })
  await vi.waitFor(() => expect(release).toBeDefined())
  const big = new Uint8Array(64 * 1024 * 1024)
  const a = service.getRendition({ kind: 'bytes', content: big })
  big[0] = 1
  await Promise.resolve()
  big[0] = 2
  const b = service.getRendition({ kind: 'bytes', content: big })
  await expect(service.getRendition({ kind: 'bytes', content: new Uint8Array([3]) })).rejects.toMatchObject({
    code: 'FILE_HEIF_BUSY'
  })
  release(fakePng)
  await Promise.all([active, a, b])
})

it('rejects a path or entry above the encoded limit before requesting bytes', async () => {
  const readChunk = vi.fn()
  MockApplicationUtils.setService('FileManager', {
    getVersion: async () => ({ size: 64 * 1024 * 1024 + 1, mtime: 1 }),
    readChunk
  })
  await expect(
    service.getRendition({ kind: 'entry', entryId: '019606a0-0000-7000-8000-000000000001' })
  ).rejects.toMatchObject({ code: 'FILE_HEIF_TOO_LARGE', data: { limit: 'input_bytes' } })
  expect(readChunk).not.toHaveBeenCalled()
})

it('never starts waiting work whose deadline elapsed while synchronous work blocked timers', async () => {
  vi.useFakeTimers()
  let release!: (value: imageUtils.HeifPng) => void
  let starts = 0
  vi.spyOn(imageUtils, 'transcodeHeifToPng').mockImplementation(() => {
    starts++
    return new Promise((resolve) => {
      release = resolve
    })
  })
  const first = service.getRendition({ kind: 'bytes', content: bytes })
  const second = service.getRendition({ kind: 'bytes', content: new Uint8Array([1]) })
  const a = expect(first).rejects.toMatchObject({ code: 'FILE_HEIF_TIMEOUT' })
  const b = expect(second).rejects.toMatchObject({ code: 'FILE_HEIF_TIMEOUT' })
  await Promise.resolve()
  await Promise.resolve()
  vi.setSystemTime(Date.now() + 30_001)
  release(fakePng)
  await Promise.all([a, b])
  expect(starts).toBe(1)
})
