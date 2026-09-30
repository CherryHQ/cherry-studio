import type * as NodeUtil from 'node:util'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '@main/core/lifecycle'

const execute = vi.hoisted(() => vi.fn())
vi.mock('node:util', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeUtil>()
  return { ...actual, promisify: () => execute }
})

import { BinaryManager } from '../BinaryManager'

let service: BinaryManager
beforeEach(() => {
  BaseService.resetInstances()
  execute.mockReset().mockResolvedValue({ stdout: '', stderr: '' })
  service = new BinaryManager()
  Object.assign(service, { miseBin: '/mock/mise', isolatedEnv: { env: {}, usesDefaultChinaPipIndex: false } })
})
afterEach(() => {
  vi.restoreAllMocks()
  BaseService.resetInstances()
})

describe('system package execution', () => {
  it('passes the caller-selected recipe to mise without imposing a product-specific platform restriction', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    vi.spyOn(process, 'arch', 'get').mockReturnValue('x64')
    const signal = new AbortController().signal
    await expect(service.installSystemPackage('apt:curl', signal)).resolves.toBeUndefined()
    expect(execute).toHaveBeenCalledWith(
      '/mock/mise',
      ['bootstrap', 'packages', 'apply', '--yes', 'apt:curl'],
      expect.objectContaining({ signal })
    )
  })

  it('serializes installation and never launches an operation cancelled while queued', async () => {
    const pending = Promise.withResolvers<{ stdout: string; stderr: string }>()
    execute.mockReturnValueOnce(pending.promise)
    const first = service.installSystemPackage('brew:curl', new AbortController().signal)
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
    const controller = new AbortController()
    const queued = service.installSystemPackage('brew:jq', controller.signal)
    controller.abort()
    const rejected = expect(queued).rejects.toBe(controller.signal.reason)
    await Promise.resolve()
    expect(execute).toHaveBeenCalledTimes(1)
    pending.resolve({ stdout: '', stderr: '' })
    await first
    await rejected
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('propagates installation failure and releases the lock for a later attempt', async () => {
    execute.mockRejectedValueOnce(new Error('Package installation failed'))
    const signal = new AbortController().signal
    await expect(service.installSystemPackage('brew:curl', signal)).rejects.toThrow('Package installation failed')
    await expect(service.installSystemPackage('brew:curl', signal)).resolves.toBeUndefined()
  })
})
