import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecFileAsync, mockFs, mockFsp } = vi.hoisted(() => ({
  mockExecFileAsync: vi.fn(),
  mockFs: { existsSync: vi.fn<(candidate: string) => boolean>(), constants: { F_OK: 0 } },
  mockFsp: { readdir: vi.fn(), access: vi.fn() }
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
vi.mock('@main/services/RegionService', () => ({ regionService: { detectIsInChina: vi.fn() } }))

const { findToolEnvironment, installToolDependencies } = await import('../pipDependencies')

const INSTALL_PATH = '/mock/mise/installs/pipx-babeldoc-stream/0.6.4.post4'
const ENVIRONMENT = `${INSTALL_PATH}/babeldoc-stream`
const UV_BIN = '/mock/cherry.bin/uv'

describe('managed pipx dependencies', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFs.existsSync.mockImplementation((candidate) => candidate === UV_BIN)
    mockFsp.readdir.mockResolvedValue(['bin', 'babeldoc-stream'])
    mockFsp.access.mockImplementation(async (candidate: string) => {
      if (candidate !== `${ENVIRONMENT}/pyvenv.cfg`) throw new Error('ENOENT')
    })
    mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' })
  })

  it('finds the venv one level below the install directory by pyvenv.cfg', async () => {
    await expect(findToolEnvironment(INSTALL_PATH)).resolves.toBe(ENVIRONMENT)
    expect(mockFsp.access).toHaveBeenCalledWith(`${ENVIRONMENT}/pyvenv.cfg`, mockFs.constants.F_OK)
  })

  it('returns null for an unreadable install or one without a venv, then rejects installation', async () => {
    mockFsp.readdir.mockRejectedValueOnce(new Error('ENOENT'))
    await expect(findToolEnvironment(INSTALL_PATH)).resolves.toBeNull()
    mockFsp.access.mockRejectedValue(new Error('ENOENT'))
    await expect(findToolEnvironment(INSTALL_PATH)).resolves.toBeNull()
    await expect(
      installToolDependencies({ installPath: INSTALL_PATH, dependencies: ['bitstring<5'], env: {} })
    ).rejects.toThrow(`No Python tool environment found in ${INSTALL_PATH}`)
    expect(mockExecFileAsync).not.toHaveBeenCalled()
  })

  it.each([[['bitstring<5']], [['bitstring<5', 'packaging>=23']]])(
    'passes each requirement as a literal uv argument: %j',
    async (dependencies) => {
      await installToolDependencies({
        installPath: INSTALL_PATH,
        dependencies,
        env: { PIP_INDEX_URL: 'https://pypi.example/simple' }
      })

      expect(mockExecFileAsync).toHaveBeenCalledWith(
        UV_BIN,
        ['pip', 'install', '--python', ENVIRONMENT, ...dependencies],
        {
          cwd: '/mock/app.temp',
          env: {
            PIP_INDEX_URL: 'https://pypi.example/simple',
            UV_PYTHON_DOWNLOADS: 'never',
            UV_HTTP_TIMEOUT: '30',
            UV_HTTP_RETRIES: '2'
          },
          timeout: 120_000
        }
      )
    }
  )

  it('sanitizes uv stderr while naming the environment that could not be updated', async () => {
    mockExecFileAsync.mockRejectedValue(
      Object.assign(new Error('Command failed'), {
        stderr: 'download https://user:password@mirror.test/file?api_key=hidden failed\n'
      })
    )

    const result = installToolDependencies({ installPath: INSTALL_PATH, dependencies: ['bitstring<5'], env: {} })
    await expect(result).rejects.toThrow(
      `Failed to update Python tool environment ${ENVIRONMENT}: Command failed\ndownload https://***@mirror.test/file?api_key=*** failed`
    )
    await expect(result).rejects.not.toThrow('password')
  })

  it('reports a missing bundled uv', async () => {
    mockFs.existsSync.mockReturnValue(false)
    await expect(
      installToolDependencies({ installPath: INSTALL_PATH, dependencies: ['bitstring<5'], env: {} })
    ).rejects.toThrow('Bundled uv is not available')
    expect(mockExecFileAsync).not.toHaveBeenCalled()
  })
})
