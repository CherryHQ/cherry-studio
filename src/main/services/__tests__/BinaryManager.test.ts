import type * as LifecycleModule from '@main/core/lifecycle'
import { getPhase } from '@main/core/lifecycle/decorators'
import { Phase } from '@main/core/lifecycle/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecFileAsync, mockFs, mockPreferenceService } = vi.hoisted(() => ({
  mockExecFileAsync: vi.fn(),
  mockFs: {
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
  },
  mockPreferenceService: { get: vi.fn(() => []) }
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    PreferenceService: mockPreferenceService
  })
})

vi.mock('@main/core/lifecycle', async (importOriginal) => {
  const actual = await importOriginal<typeof LifecycleModule>()
  class MockBaseService {
    ipcHandle = vi.fn()
    ipcOn = vi.fn()
    protected readonly _disposables: Array<{ dispose: () => void } | (() => void)> = []
    protected registerDisposable<T extends { dispose: () => void } | (() => void)>(d: T): T {
      this._disposables.push(d)
      return d
    }
  }
  return { ...actual, BaseService: MockBaseService }
})

vi.mock('node:fs', () => ({ default: mockFs }))

vi.mock('node:fs/promises', () => ({
  default: {
    mkdir: vi.fn(async () => {}),
    copyFile: vi.fn(async () => {}),
    chmod: vi.fn(async () => {}),
    writeFile: vi.fn(async () => {})
  }
}))

vi.mock('node:os', () => ({
  default: { tmpdir: () => '/tmp' }
}))

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  execFileSync: vi.fn(() => {
    throw new Error('not found')
  })
}))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []) }
}))

vi.mock('@main/utils/ipService', () => ({
  isUserInChina: vi.fn().mockResolvedValue(false)
}))

vi.mock('node:util', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...(actual as object), promisify: () => mockExecFileAsync }
})

const { BinaryManager, validateManagedBinary } = await import('../BinaryManager')

describe('BinaryManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecFileAsync.mockReset()
    mockFs.existsSync.mockReset().mockReturnValue(false)
    mockFs.readFileSync.mockReset()
  })

  describe('decorators', () => {
    it('is registered as Background phase', () => {
      expect(getPhase(BinaryManager)).toBe(Phase.Background)
    })
  })

  describe('reconcile', () => {
    it('returns error when mise binary is not available', async () => {
      const service = new BinaryManager()

      const result = await service.reconcile([{ name: 'fd', tool: 'github:sharkdp/fd', version: '10.0.0' }])

      expect(result.failed).toHaveLength(1)
      expect(result.failed[0].name).toBe('*')
      expect(result.installed).toHaveLength(0)
    })

    it('skips tools that are already at the target version', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}

      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          updatedAt: '2026-01-01T00:00:00.000Z',
          tools: {
            fd: { name: 'fd', tool: 'github:sharkdp/fd', version: '10.0.0', installedAt: '2026-01-01T00:00:00.000Z' }
          }
        })
      )

      mockExecFileAsync
        .mockResolvedValueOnce({ stdout: '/mock/mise/shims/fd\n', stderr: '' }) // which fd
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // reshim

      const result = await service.reconcile([{ name: 'fd', tool: 'github:sharkdp/fd', version: '10.0.0' }])

      expect(result.skipped).toEqual(['fd'])
      expect(result.installed).toHaveLength(0)
      expect(result.failed).toHaveLength(0)
    })

    it('skips unpinned tools that are already installed', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}

      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          updatedAt: '2026-01-01T00:00:00.000Z',
          tools: {
            fd: { name: 'fd', tool: 'github:sharkdp/fd', version: '10.0.0', installedAt: '2026-01-01T00:00:00.000Z' }
          }
        })
      )

      mockExecFileAsync
        .mockResolvedValueOnce({ stdout: '/mock/mise/shims/fd\n', stderr: '' }) // which fd
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // reshim

      const result = await service.reconcile([{ name: 'fd', tool: 'github:sharkdp/fd' }])

      expect(result.skipped).toEqual(['fd'])
      expect(result.installed).toHaveLength(0)
    })

    it('reinstalls when tool spec changes', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}

      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          updatedAt: '2026-01-01T00:00:00.000Z',
          tools: {
            fd: { name: 'fd', tool: 'github:sharkdp/fd', version: '10.0.0', installedAt: '2026-01-01T00:00:00.000Z' }
          }
        })
      )

      // spec mismatch short-circuits before isManagedBinaryReady, so no `which` call
      mockExecFileAsync
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // use
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // reshim
        .mockResolvedValueOnce({
          stdout: JSON.stringify({ 'github:other-org/fd': [{ version: '2.0.0' }] }),
          stderr: ''
        }) // ls --json

      const result = await service.reconcile([{ name: 'fd', tool: 'github:other-org/fd', version: '2.0.0' }])

      expect(result.installed).toEqual(['fd'])
      expect(result.skipped).toHaveLength(0)
    })

    it('handles install failure gracefully', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}

      mockFs.readFileSync.mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })

      mockExecFileAsync.mockRejectedValueOnce(new Error('mise use failed'))

      const result = await service.reconcile([{ name: 'fd', tool: 'github:sharkdp/fd', version: '10.0.0' }])

      expect(result.failed).toHaveLength(1)
      expect(result.failed[0].name).toBe('fd')
      expect(result.failed[0].error).toContain('mise use failed')
      expect(result.installed).toHaveLength(0)
    })

    it('installs multiple tools and records state', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}

      mockFs.readFileSync.mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })

      mockExecFileAsync
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // use fd
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // reshim fd
        .mockResolvedValueOnce({ stdout: JSON.stringify({ 'github:sharkdp/fd': [{ version: '10.0.0' }] }), stderr: '' }) // ls --json
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // use rg
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // reshim rg
        .mockResolvedValueOnce({
          stdout: JSON.stringify({ 'github:BurntSushi/ripgrep': [{ version: '15.0.0' }] }),
          stderr: ''
        }) // ls --json

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
    it('removes tool from state', async () => {
      const service = new BinaryManager()

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

      expect(mockFs.unlinkSync).not.toHaveBeenCalled()

      const lastWriteCall = mockFs.writeFileSync.mock.calls.at(-1)!
      const savedState = JSON.parse(lastWriteCall[1])
      expect(savedState.tools.fd).toBeUndefined()
    })

    it('succeeds even if binary does not exist on disk', async () => {
      const service = new BinaryManager()

      mockFs.existsSync.mockReturnValue(false)
      mockFs.readFileSync.mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })

      await service.removeTool('nonexistent')

      expect(mockFs.unlinkSync).not.toHaveBeenCalled()
      expect(mockFs.writeFileSync).not.toHaveBeenCalled()
    })
  })

  describe('installTool', () => {
    it('throws when mise binary is not available', async () => {
      const service = new BinaryManager()

      await expect(service.installTool({ name: 'fd', tool: 'github:sharkdp/fd', version: '10.0.0' })).rejects.toThrow(
        'mise binary not available'
      )
    })

    it('installs and returns version', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}

      mockFs.readFileSync.mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })

      mockExecFileAsync
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // use
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // reshim
        .mockResolvedValueOnce({ stdout: JSON.stringify({ 'github:sharkdp/fd': [{ version: '10.0.0' }] }), stderr: '' }) // ls --json

      const result = await service.installTool({ name: 'fd', tool: 'github:sharkdp/fd', version: '10.0.0' })

      expect(result.version).toBe('10.0.0')
      expect(mockFs.copyFileSync).not.toHaveBeenCalled()
      expect(mockFs.chmodSync).not.toHaveBeenCalled()
    })
  })

  describe('searchRegistry', () => {
    it('returns empty array when mise binary is not available', async () => {
      const service = new BinaryManager()
      const result = await service.searchRegistry('fd')
      expect(result).toEqual([])
    })

    it('caches registry output across calls', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}

      mockExecFileAsync.mockResolvedValue({
        stdout: 'fd   github:sharkdp/fd\nrg   github:BurntSushi/ripgrep\n',
        stderr: ''
      })

      await service.searchRegistry('fd')
      await service.searchRegistry('rg')

      expect(mockExecFileAsync).toHaveBeenCalledTimes(1)
    })
  })

  describe('IPC input validation', () => {
    it('registers IPC handlers on init', async () => {
      const service = new BinaryManager()
      await (service as any).onInit()

      const channels = (service as any).ipcHandle.mock.calls.map((c: any[]) => c[0])
      expect(channels).toContain('binary:install-tool')
      expect(channels).toContain('binary:remove-tool')
      expect(channels).toContain('binary:get-state')
      expect(channels).toContain('binary:reconcile')
      expect(channels).toContain('binary:search-registry')
      expect(channels).toContain('binary:get-tool-dir')
    })

    it('get-tool-dir handler rejects invalid tool names', async () => {
      const service = new BinaryManager()
      await (service as any).onInit()

      const handler = (service as any).ipcHandle.mock.calls.find((c: any[]) => c[0] === 'binary:get-tool-dir')?.[1]

      await expect(handler({}, '../../etc/passwd')).rejects.toThrow('Invalid tool name')
      await expect(handler({}, '')).rejects.toThrow('Invalid tool name')
    })
  })

  describe('validateManagedBinary', () => {
    it.each([
      ['../etc', 'fd', undefined],
      ['', 'fd', undefined],
      ['fd; rm -rf /', 'fd', undefined],
      ['fd\x00', 'fd', undefined],
      ['123fd', 'fd', undefined]
    ])('rejects invalid tool name=%j', (name, tool, version) => {
      expect(() => validateManagedBinary({ name, tool, version })).toThrow('Invalid tool name')
    })

    it.each([
      ['fd', '', undefined],
      ['fd', 'tool; echo', undefined],
      ['fd', 'tool name', undefined],
      ['fd', '../../../etc/passwd', undefined],
      ['fd', 'github://evil', undefined]
    ])('rejects invalid tool key=%j tool=%j', (name, tool, version) => {
      expect(() => validateManagedBinary({ name, tool, version })).toThrow('Invalid tool key')
    })

    it.each([
      ['fd', 'fd', 'version; echo'],
      ['fd', 'fd', 'ver sion']
    ])('rejects invalid version=%j', (name, tool, version) => {
      expect(() => validateManagedBinary({ name, tool, version })).toThrow('Invalid tool version')
    })

    it('accepts valid tool definitions', () => {
      expect(() => validateManagedBinary({ name: 'fd', tool: 'github:sharkdp/fd', version: '10.0.0' })).not.toThrow()
      expect(() => validateManagedBinary({ name: 'ntn', tool: 'npm:ntn' })).not.toThrow()
      expect(() => validateManagedBinary({ name: 'hermes', tool: 'pipx:hermes-agent' })).not.toThrow()
    })
  })

  describe('buildIsolatedEnv', () => {
    it('filters out non-whitelisted environment variables', async () => {
      const original = { ...process.env }
      try {
        process.env['AWS_ACCESS_KEY_ID'] = 'test-key'
        process.env['OPENAI_API_KEY'] = 'sk-test'
        process.env['SECRET_TOKEN'] = 'secret'

        const service = new BinaryManager()
        ;(service as any).miseBin = '/mock/mise'
        const env = await (service as any).buildIsolatedEnv()

        expect(env['AWS_ACCESS_KEY_ID']).toBeUndefined()
        expect(env['OPENAI_API_KEY']).toBeUndefined()
        expect(env['SECRET_TOKEN']).toBeUndefined()
        expect(env['MISE_DATA_DIR']).toBeDefined()
      } finally {
        process.env = original
      }
    })

    it('passes through whitelisted variables', async () => {
      const original = { ...process.env }
      try {
        process.env['GITHUB_TOKEN'] = 'ghp_test'
        process.env['HTTPS_PROXY'] = 'http://proxy:8080'

        const service = new BinaryManager()
        ;(service as any).miseBin = '/mock/mise'
        const env = await (service as any).buildIsolatedEnv()

        expect(env['GITHUB_TOKEN']).toBe('ghp_test')
        expect(env['HTTPS_PROXY']).toBe('http://proxy:8080')
      } finally {
        process.env = original
      }
    })
  })

  describe('installWithMise', () => {
    it('uses mise global config and reshim for npm: backend tools', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}

      mockFs.readFileSync.mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })

      mockExecFileAsync
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // use
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // reshim
        .mockResolvedValueOnce({ stdout: JSON.stringify({ 'npm:ntn': [{ version: '1.0.0' }] }), stderr: '' }) // ls --json

      const result = await service.installTool({ name: 'ntn', tool: 'npm:ntn', version: '1.0.0' })

      expect(result.version).toBe('1.0.0')
      expect(mockFs.copyFileSync).not.toHaveBeenCalled()
      expect(mockExecFileAsync).toHaveBeenCalledWith('/mock/mise', ['use', '-g', 'node@22', 'npm:ntn@1.0.0'], {
        cwd: '/tmp',
        env: {},
        timeout: 120_000
      })
      expect(mockExecFileAsync).toHaveBeenCalledWith('/mock/mise', ['reshim'], {
        cwd: '/tmp',
        env: {},
        timeout: 120_000
      })
    })
  })

  describe('withStateLock concurrency', () => {
    it('serializes concurrent installTool calls', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}

      mockFs.readFileSync.mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })

      const callOrder: string[] = []
      mockExecFileAsync.mockImplementation(async (_bin: string, args: string[]) => {
        if (args[0] === 'use') {
          const toolSpec = args[args.length - 1]
          callOrder.push(`use:${toolSpec}:start`)
          await new Promise((r) => setTimeout(r, 10))
          callOrder.push(`use:${toolSpec}:end`)
        }
        if (args[0] === 'ls') {
          const toolKey = args[2]
          return { stdout: JSON.stringify({ [toolKey]: [{ version: '1.0.0' }] }), stderr: '' }
        }
        return { stdout: '', stderr: '' }
      })

      const p1 = service.installTool({ name: 'fd', tool: 'github:sharkdp/fd', version: '10.0.0' })
      const p2 = service.installTool({ name: 'rg', tool: 'github:BurntSushi/ripgrep', version: '15.0.0' })

      await Promise.all([p1, p2])

      const useStarts = callOrder.filter((e) => e.endsWith(':start'))
      const useEnds = callOrder.filter((e) => e.endsWith(':end'))
      expect(useStarts[0]).toContain('sharkdp/fd')
      expect(useEnds[0]).toContain('sharkdp/fd')
      expect(useStarts[1]).toContain('BurntSushi/ripgrep')
    })
  })

  describe('IPC handler validateManagedBinary integration', () => {
    it('install handler rejects invalid tool names before calling installWithMise', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}
      await (service as any).onInit()

      const installHandler = (service as any).ipcHandle.mock.calls.find(
        (c: any[]) => c[0] === 'binary:install-tool'
      )?.[1]

      await expect(installHandler({}, { name: '../etc', tool: 'fd' })).rejects.toThrow('Invalid tool name')
      expect(mockExecFileAsync).not.toHaveBeenCalled()
    })

    it('install handler accepts valid tools and calls installWithMise', async () => {
      const service = new BinaryManager()
      await (service as any).onInit()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}

      mockFs.readFileSync.mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })

      mockExecFileAsync
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // use
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // reshim
        .mockResolvedValueOnce({ stdout: JSON.stringify({ 'github:sharkdp/fd': [{ version: '10.0.0' }] }), stderr: '' }) // ls --json

      const installHandler = (service as any).ipcHandle.mock.calls.find(
        (c: any[]) => c[0] === 'binary:install-tool'
      )?.[1]

      const result = await installHandler({}, { name: 'fd', tool: 'github:sharkdp/fd', version: '10.0.0' })
      expect(result.version).toBe('10.0.0')
    })
  })

  describe('runMise env/cwd contract', () => {
    it('passes isolated env and cwd to execFileAsync, not process.env', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      const isolatedEnv = { MISE_DATA_DIR: '/isolated', PATH: '/isolated/shims' }
      ;(service as any).isolatedEnv = isolatedEnv

      mockExecFileAsync.mockResolvedValueOnce({ stdout: 'ok\n', stderr: '' })

      await (service as any).runMise(['which', 'fd'], '/custom/cwd')

      expect(mockExecFileAsync).toHaveBeenCalledWith('/mock/mise', ['which', 'fd'], {
        cwd: '/custom/cwd',
        env: isolatedEnv,
        timeout: 120_000
      })
    })

    it('throws when mise binary is null', async () => {
      const service = new BinaryManager()

      await expect((service as any).runMise(['which', 'fd'], '/tmp')).rejects.toThrow('mise binary not available')
    })
  })

  describe('extractBundledBinaries', () => {
    let mockFsp: Record<string, ReturnType<typeof vi.fn>>

    beforeEach(async () => {
      const fspModule = await import('node:fs/promises')
      mockFsp = fspModule.default as unknown as Record<string, ReturnType<typeof vi.fn>>
    })

    it('skips extraction when bundled version matches installed version', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'

      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockImplementation((p: string) => {
        if (p.includes('.mise-version')) return '2025.1.0'
        return ''
      })

      await (service as any).extractBundledBinaries()

      expect(mockFsp.copyFile).not.toHaveBeenCalled()
    })

    it('copies binary when bundled version is newer than installed', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'

      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockImplementation((p: string) => {
        if (p.includes('.mise-version')) {
          return p.includes('binaries') ? '2025.2.0' : '2025.1.0'
        }
        return ''
      })

      await (service as any).extractBundledBinaries()

      expect(mockFsp.copyFile).toHaveBeenCalled()
    })

    it('copies binary when no installed version exists', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'

      mockFs.readFileSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.includes('binaries') && p.includes('.mise-version')) return '2025.1.0'
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })
      mockFs.existsSync.mockImplementation((...args: unknown[]) => {
        const p = args[0]
        if (typeof p === 'string' && p.includes('binaries')) return true
        return false
      })

      await (service as any).extractBundledBinaries()

      expect(mockFsp.copyFile).toHaveBeenCalled()
    })
  })

  describe('loadState validation', () => {
    it('discards malformed tool entries from state file', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}

      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          updatedAt: '2026-01-01T00:00:00.000Z',
          tools: {
            valid: {
              name: 'fd',
              tool: 'github:sharkdp/fd',
              version: '10.0.0',
              installedAt: '2026-01-01T00:00:00.000Z'
            },
            broken: { name: 'bad', tool: undefined, version: '1.0.0' },
            injected: { name: 'evil', tool: '../../../etc/passwd', version: '1.0.0' }
          }
        })
      )

      const state = (service as any).loadState()
      expect(state.tools.valid).toBeDefined()
      expect(state.tools.broken).toBeUndefined()
      expect(state.tools.injected).toBeUndefined()
    })
  })

  describe('reconcile stateSaveError', () => {
    it('populates stateSaveError when saveState throws', async () => {
      const service = new BinaryManager()
      ;(service as any).miseBin = '/mock/mise'
      ;(service as any).isolatedEnv = {}

      mockFs.readFileSync.mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })

      mockExecFileAsync
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // use
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // reshim
        .mockResolvedValueOnce({ stdout: JSON.stringify({ 'github:sharkdp/fd': [{ version: '10.0.0' }] }), stderr: '' }) // ls --json

      mockFs.writeFileSync.mockImplementation(() => {
        throw new Error('disk full')
      })

      const result = await service.reconcile([{ name: 'fd', tool: 'github:sharkdp/fd', version: '10.0.0' }])

      expect(result.installed).toEqual(['fd'])
      expect(result.stateSaveError).toContain('disk full')
    })
  })
})
