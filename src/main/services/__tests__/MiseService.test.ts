import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecFileAsync, mockFs } = vi.hoisted(() => {
  const mockExecFileAsync = vi.fn()
  const mockFs = {
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    mkdtempSync: vi.fn(() => '/tmp/cherry-mise-test'),
    copyFileSync: vi.fn(),
    chmodSync: vi.fn(),
    unlinkSync: vi.fn(),
    rmSync: vi.fn(),
    renameSync: vi.fn()
  }
  return { mockExecFileAsync, mockFs }
})

vi.mock('@main/core/lifecycle', () => {
  class MockBaseService {
    ipcHandle = vi.fn()
    ipcOn = vi.fn()
    registerDisposable = vi.fn()
  }
  return {
    BaseService: MockBaseService,
    Injectable: () => (target: unknown) => target,
    ServicePhase: () => (target: unknown) => target,
    Phase: { Background: 'background', WhenReady: 'whenReady', BeforeReady: 'beforeReady' }
  }
})

const mockPreferenceService = { get: vi.fn(() => []) }

vi.mock('@application', () => ({
  application: {
    get: vi.fn((name: string) => {
      if (name === 'PreferenceService') return mockPreferenceService
      throw new Error(`[MockApplication] Unknown service: ${name}`)
    }),
    getPath: vi.fn((key: string) => `/mock/${key}`)
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('@main/constant', () => ({ isWin: false }))

vi.mock('node:fs', () => ({ default: mockFs }))

vi.mock('node:os', () => ({
  default: { tmpdir: () => '/tmp' }
}))

vi.mock('node:child_process', () => ({
  execFile: vi.fn()
}))

vi.mock('node:util', () => ({
  promisify: () => mockExecFileAsync
}))

import { MiseService } from '../MiseService'

describe('MiseService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('reconcile', () => {
    it('returns error when mise binary is not available', async () => {
      const service = new MiseService()

      const result = await service.reconcile([{ name: 'fd', tool: 'github:sharkdp/fd', version: '10.0.0' }])

      expect(result.failed).toHaveLength(1)
      expect(result.failed[0].name).toBe('*')
      expect(result.installed).toHaveLength(0)
    })

    it('skips tools that are already at the target version', async () => {
      const service = new MiseService()
      ;(service as any).miseBin = '/mock/mise'

      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          updatedAt: '2026-01-01T00:00:00.000Z',
          tools: {
            fd: { name: 'fd', tool: 'github:sharkdp/fd', version: '10.0.0', installedAt: '2026-01-01T00:00:00.000Z' }
          }
        })
      )

      const result = await service.reconcile([{ name: 'fd', tool: 'github:sharkdp/fd', version: '10.0.0' }])

      expect(result.skipped).toEqual(['fd'])
      expect(result.installed).toHaveLength(0)
      expect(result.failed).toHaveLength(0)
    })

    it('does not skip tools with no pinned version (latest)', async () => {
      const service = new MiseService()
      ;(service as any).miseBin = '/mock/mise'

      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          updatedAt: '2026-01-01T00:00:00.000Z',
          tools: {
            fd: { name: 'fd', tool: 'github:sharkdp/fd', version: '10.0.0', installedAt: '2026-01-01T00:00:00.000Z' }
          }
        })
      )

      mockExecFileAsync
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // trust
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // install
        .mockResolvedValueOnce({ stdout: '/path/to/fd\n', stderr: '' }) // which
        .mockResolvedValueOnce({ stdout: '10.1.0\n', stderr: '' }) // which --version

      const result = await service.reconcile([{ name: 'fd', tool: 'github:sharkdp/fd' }])

      expect(result.installed).toEqual(['fd'])
      expect(result.skipped).toHaveLength(0)
    })

    it('handles install failure gracefully', async () => {
      const service = new MiseService()
      ;(service as any).miseBin = '/mock/mise'

      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('ENOENT')
      })

      mockExecFileAsync.mockRejectedValueOnce(new Error('mise trust failed'))

      const result = await service.reconcile([{ name: 'fd', tool: 'github:sharkdp/fd', version: '10.0.0' }])

      expect(result.failed).toHaveLength(1)
      expect(result.failed[0].name).toBe('fd')
      expect(result.failed[0].error).toContain('mise trust failed')
      expect(result.installed).toHaveLength(0)
    })

    it('installs multiple tools and records state', async () => {
      const service = new MiseService()
      ;(service as any).miseBin = '/mock/mise'

      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('ENOENT')
      })

      mockExecFileAsync
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // trust fd
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // install fd
        .mockResolvedValueOnce({ stdout: '/path/to/fd\n', stderr: '' }) // which fd
        .mockResolvedValueOnce({ stdout: '10.0.0\n', stderr: '' }) // which fd --version
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // trust rg
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // install rg
        .mockResolvedValueOnce({ stdout: '/path/to/rg\n', stderr: '' }) // which rg
        .mockResolvedValueOnce({ stdout: '15.0.0\n', stderr: '' }) // which rg --version

      const result = await service.reconcile([
        { name: 'fd', tool: 'github:sharkdp/fd', version: '10.0.0' },
        { name: 'rg', tool: 'github:BurntSushi/ripgrep', version: '15.0.0' }
      ])

      expect(result.installed).toEqual(['fd', 'rg'])
      expect(result.failed).toHaveLength(0)

      expect(mockFs.writeFileSync).toHaveBeenCalled()
      const lastWriteCall = mockFs.writeFileSync.mock.calls.at(-1)!
      const savedState = JSON.parse(lastWriteCall[1])
      expect(savedState.tools.fd.version).toBe('10.0.0')
      expect(savedState.tools.rg.version).toBe('15.0.0')
    })
  })

  describe('removeTool', () => {
    it('deletes binary and removes from state', async () => {
      const service = new MiseService()

      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          updatedAt: '2026-01-01T00:00:00.000Z',
          tools: {
            fd: { name: 'fd', tool: 'github:sharkdp/fd', version: '10.0.0', installedAt: '2026-01-01T00:00:00.000Z' }
          }
        })
      )

      await service.removeTool('fd')

      expect(mockFs.unlinkSync).toHaveBeenCalledWith('/mock/cherry.bin/fd')

      const lastWriteCall = mockFs.writeFileSync.mock.calls.at(-1)!
      const savedState = JSON.parse(lastWriteCall[1])
      expect(savedState.tools.fd).toBeUndefined()
    })

    it('succeeds even if binary does not exist on disk', async () => {
      const service = new MiseService()

      mockFs.existsSync.mockReturnValue(false)
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('ENOENT')
      })

      await service.removeTool('nonexistent')

      expect(mockFs.unlinkSync).not.toHaveBeenCalled()
      expect(mockFs.writeFileSync).toHaveBeenCalled()
    })
  })

  describe('installTool', () => {
    it('throws when mise binary is not available', async () => {
      const service = new MiseService()

      await expect(service.installTool({ name: 'fd', tool: 'github:sharkdp/fd', version: '10.0.0' })).rejects.toThrow(
        'mise binary not available'
      )
    })

    it('installs and returns version', async () => {
      const service = new MiseService()
      ;(service as any).miseBin = '/mock/mise'

      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('ENOENT')
      })

      mockExecFileAsync
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // trust
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // install
        .mockResolvedValueOnce({ stdout: '/path/to/fd\n', stderr: '' }) // which
        .mockResolvedValueOnce({ stdout: '10.0.0\n', stderr: '' }) // which --version

      const result = await service.installTool({ name: 'fd', tool: 'github:sharkdp/fd', version: '10.0.0' })

      expect(result.version).toBe('10.0.0')
      expect(mockFs.copyFileSync).toHaveBeenCalled()
      expect(mockFs.chmodSync).toHaveBeenCalled()
    })
  })
})
