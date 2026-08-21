import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecFileAsync, mockFs, mockFsp } = vi.hoisted(() => ({
  mockExecFileAsync: vi.fn(),
  mockFs: { existsSync: vi.fn((_candidate: string) => false) },
  mockFsp: { mkdir: vi.fn(async () => {}) }
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({})
})

vi.mock('fs', () => ({ default: mockFs }))

vi.mock('node:fs/promises', () => ({ default: mockFsp }))

vi.mock('node:os', () => ({ default: { tmpdir: () => '/tmp' } }))

vi.mock('node:child_process', () => ({ execFile: vi.fn() }))

vi.mock('node:util', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...(actual as object), promisify: () => mockExecFileAsync }
})

vi.mock('@main/services/RegionService', () => ({
  regionService: { isInChina: vi.fn().mockResolvedValue(false) }
}))

const { regionService } = await import('@main/services/RegionService')
const { provideManagedPython } = await import('../pythonRuntime')

const UV_BIN = '/mock/cherry.bin/uv'
const INSTALL_DIR = '/mock/feature.binary.data/uv-python'
const MANAGED_PYTHON = `${INSTALL_DIR}/cpython-3.12.13/bin/python`
const MODELSCOPE_MIRROR = 'https://www.modelscope.cn/datasets/awwaawwa/BabelDOCAssets/resolve/master/python'

const uvCalls = (subcommand: string) =>
  mockExecFileAsync.mock.calls.filter(
    (call: any[]) => call[0] === UV_BIN && call[1][0] === 'python' && call[1][1] === subcommand
  )

describe('provideManagedPython', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecFileAsync.mockReset()
    mockFs.existsSync.mockReset().mockImplementation((candidate: string) => candidate === UV_BIN)
    mockFsp.mkdir.mockReset().mockResolvedValue(undefined)
    vi.mocked(regionService.isInChina).mockReset().mockResolvedValue(false)
  })

  it('reuses an interpreter uv already has, without downloading one', async () => {
    mockExecFileAsync.mockImplementation(async (bin: string, args: string[]) => {
      if (bin === UV_BIN && args[1] === 'find') return { stdout: `${MANAGED_PYTHON}\n`, stderr: '' }
      if (bin === MANAGED_PYTHON) return { stdout: 'Python 3.12.13\n', stderr: '' }
      return { stdout: '', stderr: '' }
    })

    await expect(provideManagedPython('3.12', {})).resolves.toBe(MANAGED_PYTHON)
    expect(uvCalls('install')).toHaveLength(0)
  })

  it('refuses an interpreter outside Cherry storage and installs a managed one instead', async () => {
    let installed = false
    mockExecFileAsync.mockImplementation(async (bin: string, args: string[]) => {
      if (bin === UV_BIN && args[1] === 'install') {
        installed = true
        return { stdout: '', stderr: '' }
      }
      if (bin === UV_BIN && args[1] === 'find') {
        return { stdout: `${installed ? MANAGED_PYTHON : '/usr/bin/python3'}\n`, stderr: '' }
      }
      if (bin === MANAGED_PYTHON) return { stdout: 'Python 3.12.13\n', stderr: '' }
      return { stdout: '', stderr: '' }
    })

    await expect(provideManagedPython('3.12', {})).resolves.toBe(MANAGED_PYTHON)
    expect(uvCalls('install')).toHaveLength(1)
  })

  it('reinstalls when the stored interpreter no longer runs', async () => {
    let repaired = false
    mockExecFileAsync.mockImplementation(async (bin: string, args: string[]) => {
      if (bin === UV_BIN && args[1] === 'install') {
        repaired = true
        return { stdout: '', stderr: '' }
      }
      if (bin === UV_BIN && args[1] === 'find') return { stdout: `${MANAGED_PYTHON}\n`, stderr: '' }
      if (bin === MANAGED_PYTHON) {
        if (!repaired) throw new Error('dyld: library not loaded')
        return { stdout: 'Python 3.12.13\n', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })

    await expect(provideManagedPython('3.12', {})).resolves.toBe(MANAGED_PYTHON)
    expect(uvCalls('install')).toHaveLength(1)
  })

  it('installs from the ModelScope mirror in China', async () => {
    vi.mocked(regionService.isInChina).mockResolvedValue(true)
    let installed = false
    mockExecFileAsync.mockImplementation(async (bin: string, args: string[]) => {
      if (bin === UV_BIN && args[1] === 'install') {
        installed = true
        return { stdout: '', stderr: '' }
      }
      if (bin === UV_BIN && args[1] === 'find') {
        if (!installed) throw new Error('no managed python')
        return { stdout: `${MANAGED_PYTHON}\n`, stderr: '' }
      }
      if (bin === MANAGED_PYTHON) return { stdout: 'Python 3.12.13\n', stderr: '' }
      return { stdout: '', stderr: '' }
    })

    await expect(provideManagedPython('3.12', {})).resolves.toBe(MANAGED_PYTHON)
    expect(uvCalls('install')[0]?.[2].env.UV_PYTHON_INSTALL_MIRROR).toBe(MODELSCOPE_MIRROR)
  })

  it('never reaches for the mirror outside China', async () => {
    let installed = false
    mockExecFileAsync.mockImplementation(async (bin: string, args: string[]) => {
      if (bin === UV_BIN && args[1] === 'install') {
        installed = true
        return { stdout: '', stderr: '' }
      }
      if (bin === UV_BIN && args[1] === 'find') {
        if (!installed) throw new Error('no managed python')
        return { stdout: `${MANAGED_PYTHON}\n`, stderr: '' }
      }
      if (bin === MANAGED_PYTHON) return { stdout: 'Python 3.12.13\n', stderr: '' }
      return { stdout: '', stderr: '' }
    })

    await expect(provideManagedPython('3.12', {})).resolves.toBe(MANAGED_PYTHON)
    const installs = uvCalls('install')
    expect(installs).toHaveLength(1)
    expect(installs[0]?.[2].env.UV_PYTHON_INSTALL_MIRROR).toBeUndefined()
  })

  it('falls back to the official source only after the ModelScope mirror fails', async () => {
    vi.mocked(regionService.isInChina).mockResolvedValue(true)
    let installed = false
    mockExecFileAsync.mockImplementation(
      async (bin: string, args: string[], options: { env?: Record<string, string> }) => {
        if (bin === UV_BIN && args[1] === 'install') {
          if (options.env?.UV_PYTHON_INSTALL_MIRROR) throw new Error('ModelScope unavailable')
          installed = true
          return { stdout: '', stderr: '' }
        }
        if (bin === UV_BIN && args[1] === 'find') {
          if (!installed) throw new Error('no managed python')
          return { stdout: `${MANAGED_PYTHON}\n`, stderr: '' }
        }
        if (bin === MANAGED_PYTHON) return { stdout: 'Python 3.12.13\n', stderr: '' }
        return { stdout: '', stderr: '' }
      }
    )

    await expect(provideManagedPython('3.12', {})).resolves.toBe(MANAGED_PYTHON)

    const installs = uvCalls('install')
    expect(installs).toHaveLength(2)
    expect(installs[0]?.[2].env.UV_PYTHON_INSTALL_MIRROR).toBe(MODELSCOPE_MIRROR)
    expect(installs[1]?.[2].env.UV_PYTHON_INSTALL_MIRROR).toBeUndefined()
  })

  it('reports every source that failed, with credentials redacted', async () => {
    vi.mocked(regionService.isInChina).mockResolvedValue(true)
    mockExecFileAsync.mockImplementation(
      async (bin: string, args: string[], options: { env?: Record<string, string> }) => {
        if (bin === UV_BIN && args[1] === 'install') {
          throw options.env?.UV_PYTHON_INSTALL_MIRROR
            ? new Error('https://user:password@mirror.test/python failed')
            : new Error('github unreachable')
        }
        throw new Error('no managed python')
      }
    )

    await expect(provideManagedPython('3.12', {})).rejects.toThrow(
      /ModelScope: https:\/\/\*\*\*@mirror\.test\/python failed[\s\S]*official: github unreachable/
    )
  })

  it('passes the caller env through to uv', async () => {
    mockExecFileAsync.mockImplementation(async (bin: string, args: string[]) => {
      if (bin === UV_BIN && args[1] === 'find') return { stdout: `${MANAGED_PYTHON}\n`, stderr: '' }
      if (bin === MANAGED_PYTHON) return { stdout: 'Python 3.12.13\n', stderr: '' }
      return { stdout: '', stderr: '' }
    })

    await provideManagedPython('3.12', { HOME: '/mock/isolated-home', HTTPS_PROXY: 'http://proxy.test:8080' })

    expect(uvCalls('find')[0]?.[2].env).toMatchObject({
      HOME: '/mock/isolated-home',
      HTTPS_PROXY: 'http://proxy.test:8080',
      UV_PYTHON_INSTALL_DIR: INSTALL_DIR
    })
  })
})
