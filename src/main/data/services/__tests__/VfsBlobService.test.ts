import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { VfsBlobService } from '@data/services/VfsBlobService'
import { BaseService } from '@main/core/lifecycle'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { tmpRef } = vi.hoisted(() => ({
  tmpRef: { current: '' as string }
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const mod = mockApplicationFactory()
  mod.application.getPath = vi.fn((key: string) => {
    if (key === 'feature.context_chef.vfs') return tmpRef.current
    throw new Error(`Unexpected getPath('${key}') in vfs blob service test`)
  })
  return mod
})

describe('VfsBlobService', () => {
  let svc: VfsBlobService

  beforeAll(() => {
    BaseService.resetInstances()
  })

  beforeEach(() => {
    BaseService.resetInstances()
    tmpRef.current = fs.mkdtempSync(path.join(os.tmpdir(), 'vfs-svc-test-'))
    svc = new VfsBlobService()
    ;(svc as unknown as { onInit(): void }).onInit()
  })

  afterEach(() => {
    fs.rmSync(tmpRef.current, { recursive: true, force: true })
  })

  afterAll(() => {
    BaseService.resetInstances()
  })

  describe('getAdapter', () => {
    it('returns a single FileSystemAdapter writing under the configured root', () => {
      const adapter = svc.getAdapter()
      adapter.write('vfs_get.txt', 'shared adapter')
      expect(fs.readFileSync(path.join(tmpRef.current, 'vfs_get.txt'), 'utf8')).toBe('shared adapter')
      // Same instance across calls — chef middleware can cache it safely.
      expect(svc.getAdapter()).toBe(adapter)
    })

    it('exposes getPhysicalPath so chef writes absolute paths into markers', () => {
      const adapter = svc.getAdapter()
      adapter.write('vfs_path.txt', 'has a path')
      expect(adapter.getPhysicalPath('vfs_path.txt')).toBe(path.join(tmpRef.current, 'vfs_path.txt'))
    })
  })

  describe('getRoot', () => {
    it('returns the absolute storage directory', () => {
      expect(svc.getRoot()).toBe(tmpRef.current)
    })
  })

  describe('sweepStale', () => {
    it('unlinks files older than the cutoff', async () => {
      const old = path.join(tmpRef.current, 'vfs_old.txt')
      const fresh = path.join(tmpRef.current, 'vfs_fresh.txt')
      fs.writeFileSync(old, 'old')
      fs.writeFileSync(fresh, 'fresh')
      // Backdate `old` past a 1-day cutoff.
      const past = (Date.now() - 2 * 24 * 60 * 60 * 1000) / 1000
      fs.utimesSync(old, past, past)

      const { deleted } = await svc.sweepStale(24 * 60 * 60 * 1000)
      expect(deleted).toBe(1)
      expect(fs.existsSync(old)).toBe(false)
      expect(fs.existsSync(fresh)).toBe(true)
    })

    it('returns 0 deletions when everything is fresh', async () => {
      svc.getAdapter().write('vfs_a.txt', 'a')
      svc.getAdapter().write('vfs_b.txt', 'b')
      const { deleted } = await svc.sweepStale(24 * 60 * 60 * 1000)
      expect(deleted).toBe(0)
    })

    it('recreates the root when it has been removed externally', async () => {
      fs.rmSync(tmpRef.current, { recursive: true, force: true })
      const { deleted } = await svc.sweepStale()
      expect(deleted).toBe(0)
      expect(fs.existsSync(tmpRef.current)).toBe(true)
    })
  })
})
