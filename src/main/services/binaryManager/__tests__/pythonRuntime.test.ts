import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecFileAsync, mockFs, mockFsp } = vi.hoisted(() => ({
  mockExecFileAsync: vi.fn(),
  mockFs: { existsSync: vi.fn<(candidate: string) => boolean>() },
  mockFsp: { mkdir: vi.fn(async () => {}) }
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({})
})

vi.mock('fs', () => ({ default: mockFs }))

vi.mock('node:fs/promises', () => ({ default: mockFsp }))

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
const INSTALL_DIR = '/mock/feature.binary.data.uv_python'
const APP_TEMP = '/mock/app.temp'
const MANAGED_PYTHON = `${INSTALL_DIR}/cpython-3.12.13/bin/python`
const CHINA_PYTHON_MIRROR = 'https://registry.npmmirror.com/-/binary/python-build-standalone'

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

  it('repairs a managed install that no longer runs, which a plain install would skip', async () => {
    let repaired = false
    mockExecFileAsync.mockImplementation(async (bin: string, args: string[]) => {
      if (bin === UV_BIN && args[1] === 'install') {
        // uv keeps listing the version, so a plain install exits successfully
        // without replacing the broken copy.
        if (!args.includes('--reinstall')) return { stdout: 'Python 3.12.13 is already installed\n', stderr: '' }
        repaired = true
        return { stdout: '', stderr: '' }
      }
      // uv reports an interpreter it cannot inspect exactly as it reports an
      // absent one, so a corrupt install is indistinguishable from no install.
      if (bin === UV_BIN && args[1] === 'find') {
        if (!repaired) throw new Error('Failed to inspect Python interpreter from managed installations')
        return { stdout: `${MANAGED_PYTHON}\n`, stderr: '' }
      }
      if (bin === MANAGED_PYTHON) return { stdout: 'Python 3.12.13\n', stderr: '' }
      return { stdout: '', stderr: '' }
    })

    await expect(provideManagedPython('3.12', {})).resolves.toBe(MANAGED_PYTHON)
    expect(uvCalls('install')).toHaveLength(1)
  })

  it('installs from the China mirror when in China', async () => {
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
    expect(uvCalls('install')[0]?.[2].env.UV_PYTHON_INSTALL_MIRROR).toBe(CHINA_PYTHON_MIRROR)
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

  it('falls back to the official source only after the China mirror fails', async () => {
    vi.mocked(regionService.isInChina).mockResolvedValue(true)
    let installed = false
    mockExecFileAsync.mockImplementation(
      async (bin: string, args: string[], options: { env?: Record<string, string> }) => {
        if (bin === UV_BIN && args[1] === 'install') {
          if (options.env?.UV_PYTHON_INSTALL_MIRROR) throw new Error('npmmirror unavailable')
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
    expect(installs[0]?.[2].env.UV_PYTHON_INSTALL_MIRROR).toBe(CHINA_PYTHON_MIRROR)
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
      /npmmirror: https:\/\/\*\*\*@mirror\.test\/python failed[\s\S]*official: github unreachable/
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
    // Every path this module hands a subprocess comes from the registry, so the
    // isolated HOME above can never be undercut by an ambient temp directory.
    expect(uvCalls('find')[0]?.[2].cwd).toBe(APP_TEMP)
  })
})
