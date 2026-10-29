import { createHash } from 'node:crypto'
import type * as NodeUtil from 'node:util'

import { net } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '@main/core/lifecycle'

import { BinaryManager } from '../BinaryManager'

const { execFileAsync, platform } = vi.hoisted(() => ({ execFileAsync: vi.fn(), platform: { isWin: true } }))

vi.mock('node:util', async (importOriginal) => ({
  ...(await importOriginal<typeof NodeUtil>()),
  promisify: () => execFileAsync
}))

vi.mock('@main/core/platform', () => ({
  get isWin() {
    return platform.isWin
  }
}))

type Installer = {
  miseBin: string
  isolatedEnv: { env: Record<string, string>; usesDefaultChinaPipIndex: boolean }
  installWithMise: (definition: { name: string; tool: string }, version: string, definitions: []) => Promise<string>
}

describe('Claude native installation on Windows ARM64', () => {
  let installer: Installer
  const originalArch = Object.getOwnPropertyDescriptor(process, 'arch')!

  beforeEach(() => {
    BaseService.resetInstances()
    platform.isWin = true
    installer = new BinaryManager() as unknown as Installer
    installer.miseBin = '/fixture/mise'
    installer.isolatedEnv = {
      env: { NPM_CONFIG_REGISTRY: 'https://registry.npmmirror.com' },
      usesDefaultChinaPipIndex: false
    }
    vi.mocked(net.fetch).mockImplementation(async () =>
      Response.json({
        name: '@anthropic-ai/claude-code-win32-arm64',
        version: '2.1.312',
        dist: { integrity: 'sha512-' + createHash('sha512').update('native-arm64-package').digest('base64') }
      })
    )
  })

  afterEach(() => {
    Object.defineProperty(process, 'arch', originalArch)
    vi.clearAllMocks()
  })

  it.each(['latest', '2.1.312'])('installs the verified npm platform archive for %s', async (requested) => {
    Object.defineProperty(process, 'arch', { value: 'arm64' })
    let installed = false
    execFileAsync.mockImplementation(async (_file, args: string[]) => {
      if (args[0] === 'ls' && args[2] !== 'http:claude') throw new Error('Wrong mise identity')
      if (args[0] === 'use') {
        const spec = args.at(-1)!
        const encodedUrl = /url=("[^"]+")/.exec(spec)?.[1]
        const url = encodedUrl ? JSON.parse(encodedUrl) : undefined
        const checksum = /checksum="([^"]+)"/.exec(spec)?.[1]
        const publishedUrl =
          'https://registry.npmmirror.com/@anthropic-ai/claude-code-win32-arm64/-/claude-code-win32-arm64-{{ version }}.tgz'
        if (
          url !== publishedUrl ||
          !spec.includes('bin="claude.exe"') ||
          checksum !== 'sha512:' + createHash('sha512').update('native-arm64-package').digest('hex') ||
          !spec.endsWith('@2.1.312')
        ) {
          throw new Error('The ARM64 platform archive or integrity was not selected')
        }
        installed = true
      }
      return {
        stdout:
          args[0] === 'ls' && installed
            ? JSON.stringify({ 'http:claude': [{ version: '2.1.312', active: true }] })
            : '',
        stderr: ''
      }
    })
    await expect(installer.installWithMise({ name: 'claude', tool: 'claude' }, requested, [])).resolves.toBe('2.1.312')
  })

  it.each(['metadata', 'archive'])('falls back to the official source after a mirror %s failure', async (failure) => {
    Object.defineProperty(process, 'arch', { value: 'arm64' })
    if (failure === 'metadata') vi.mocked(net.fetch).mockResolvedValueOnce(new Response(null, { status: 404 }))
    let officialInstalled = false
    execFileAsync.mockImplementation(async (_file, args: string[]) => {
      if (args[0] === 'ls' && args[2] !== 'http:claude') throw new Error('Wrong mise identity')
      if (args[0] === 'use') {
        if (args.at(-1)!.includes('registry.npmmirror.com')) throw new Error('archive integrity mismatch')
        if (!args.at(-1)!.includes('registry.npmjs.org')) throw new Error('Unexpected download source')
        officialInstalled = true
      }
      return {
        stdout:
          args[0] === 'ls' && officialInstalled
            ? JSON.stringify({ 'http:claude': [{ version: '2.1.312', active: true }] })
            : '',
        stderr: ''
      }
    })
    await expect(installer.installWithMise({ name: 'claude', tool: 'claude' }, 'latest', [])).resolves.toBe('2.1.312')
  })

  it('does not silently replace a custom registry when it is unavailable', async () => {
    Object.defineProperty(process, 'arch', { value: 'arm64' })
    installer.isolatedEnv.env.NPM_CONFIG_REGISTRY = 'https://packages.example.test'
    vi.mocked(net.fetch).mockImplementation(async (url) =>
      String(url).startsWith('https://packages.example.test/')
        ? new Response(null, { status: 404 })
        : Response.json({ name: '@anthropic-ai/claude-code-win32-arm64', version: '2.1.312' })
    )
    await expect(installer.installWithMise({ name: 'claude', tool: 'claude' }, 'latest', [])).rejects.toThrow(
      'HTTP 404'
    )
  })

  it.each([
    [true, 'arm64', 'applied'],
    [true, 'x64', 'absent'],
    [false, 'arm64', 'absent']
  ])('matches the HTTP inventory only on isWin=%s arch=%s', async (isWin, arch, status) => {
    platform.isWin = isWin
    Object.defineProperty(process, 'arch', { value: arch })
    const service = installer as any
    vi.spyOn(service, 'getCustomDefinitions').mockReturnValue([])
    vi.spyOn(service, 'listMiseInstalls').mockResolvedValue({
      'http:claude': [{ version: '2.1.312', active: true }]
    })
    vi.spyOn(service, 'resolveRunnableShim').mockResolvedValue({ path: '/shim/claude', canonical: '/bin/claude' })
    vi.spyOn(service, 'probeBundled').mockReturnValue({})
    vi.spyOn(service, 'probeSystem').mockResolvedValue({})
    const snapshots = await service.getToolSnapshots(['claude'])
    expect(snapshots.claude.application.status).toBe(status)
  })

  it('removes the installed HTTP recipe and verifies that recipe is absent', async () => {
    Object.defineProperty(process, 'arch', { value: 'arm64' })
    const service = installer as any
    vi.spyOn(service, 'getCustomDefinitions').mockReturnValue([])
    vi.spyOn(service, 'getToolSnapshots').mockResolvedValue({ claude: { application: { status: 'broken' } } })
    vi.spyOn(service, 'setOperation').mockImplementation(() => {})
    const installed = new Map<string, Array<{ version: string }>>([['http:claude', [{ version: '2.1.312' }]]])
    execFileAsync.mockImplementation(async (_file, args: string[]) => {
      if (args[0] === 'uninstall') installed.delete(args[2]!)
      if (args[0] === 'ls') {
        const entries = installed.get(args[2]!)
        return { stdout: JSON.stringify(entries ? { [args[2]!]: entries } : {}), stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    await expect(service.removeToolImpl('claude', false)).resolves.toEqual({ status: 'removed' })
    expect(installed.size).toBe(0)
  })

  it('removes a legacy plain-recipe install instead of blocking on it', async () => {
    Object.defineProperty(process, 'arch', { value: 'arm64' })
    const service = installer as any
    vi.spyOn(service, 'getCustomDefinitions').mockReturnValue([])
    vi.spyOn(service, 'getToolSnapshots').mockResolvedValue({ claude: { application: { status: 'applied' } } })
    vi.spyOn(service, 'setOperation').mockImplementation(() => {})
    const installed = new Map<string, Array<{ version: string }>>([['claude', [{ version: '2.0.0' }]]])
    execFileAsync.mockImplementation(async (_file, args: string[]) => {
      if (args[0] === 'uninstall') installed.delete(args[2]!)
      if (args[0] === 'ls') {
        const entries = installed.get(args[2]!)
        return { stdout: JSON.stringify(entries ? { [args[2]!]: entries } : {}), stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    await expect(service.removeToolImpl('claude', false)).resolves.toEqual({ status: 'removed' })
    expect(installed.size).toBe(0)
  })

  it('keeps a legacy plain-recipe install manageable on Windows ARM64', async () => {
    Object.defineProperty(process, 'arch', { value: 'arm64' })
    const service = installer as any
    vi.spyOn(service, 'getCustomDefinitions').mockReturnValue([])
    vi.spyOn(service, 'listMiseInstalls').mockResolvedValue({ claude: [{ version: '2.0.0', active: true }] })
    const runnable = vi
      .spyOn(service, 'resolveRunnableShim')
      .mockResolvedValue({ path: '/shim/claude', canonical: '/bin/claude' })
    vi.spyOn(service, 'probeBundled').mockReturnValue({})
    vi.spyOn(service, 'probeSystem').mockResolvedValue({})
    const snapshots = await service.getToolSnapshots(['claude'])
    expect(snapshots.claude.application).toEqual({ status: 'applied', version: '2.0.0' })
    // The runnable proof must ask mise for the identity the package is installed under.
    expect(runnable).toHaveBeenCalledWith('claude', 'claude')
  })

  it('retires the legacy identity once an update installs the HTTP recipe', async () => {
    Object.defineProperty(process, 'arch', { value: 'arm64' })
    const service = installer as any
    vi.spyOn(service, 'installWithMise').mockResolvedValue('2.1.312')
    vi.spyOn(service, 'isRecipeRunnable').mockResolvedValue(true)
    const installed = new Map<string, Array<{ version: string }>>([['claude', [{ version: '2.0.0' }]]])
    execFileAsync.mockImplementation(async (_file, args: string[]) => {
      if (args[0] === 'uninstall') installed.delete(args[2]!)
      if (args[0] === 'ls') {
        const entries = installed.get(args[2]!)
        return { stdout: JSON.stringify(entries ? { [args[2]!]: entries } : {}), stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    await service.applyDefinition({ name: 'claude', tool: 'claude' }, '2.1.312', [])
    expect(installed.has('claude')).toBe(false)
  })

  it.each([
    [true, 'x64'],
    [false, 'arm64'],
    [false, 'x64']
  ])('keeps the registry recipe on isWin=%s arch=%s', async (isWin, arch) => {
    platform.isWin = isWin
    Object.defineProperty(process, 'arch', { value: arch })
    execFileAsync.mockImplementation(async (_file, args: string[]) => {
      if (args[0] === 'use' && args.at(-1) !== 'claude@2.1.239') {
        throw new Error('An ARM64 Windows artifact cannot be installed on this platform')
      }
      return { stdout: JSON.stringify({ claude: [{ version: '2.1.239', active: true }] }), stderr: '' }
    })

    await expect(installer.installWithMise({ name: 'claude', tool: 'claude' }, '2.1.239', [])).resolves.toBe('2.1.239')
  })
})
