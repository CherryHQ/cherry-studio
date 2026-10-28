import type * as NodeUtil from 'node:util'

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

describe('Claude native installation on Windows ARM64', () => {
  const originalArch = Object.getOwnPropertyDescriptor(process, 'arch')!

  beforeEach(() => {
    BaseService.resetInstances()
    platform.isWin = true
  })

  afterEach(() => {
    Object.defineProperty(process, 'arch', originalArch)
    vi.clearAllMocks()
  })

  it.each(['latest', '2.1.239'])('downloads the published ARM64 executable for %s', async (requested) => {
    Object.defineProperty(process, 'arch', { value: 'arm64' })
    const service = new BinaryManager()
    const installer = service as unknown as {
      miseBin: string
      isolatedEnv: { env: Record<string, string>; usesDefaultChinaPipIndex: boolean }
      installWithMise: (definition: { name: string; tool: string }, version: string, definitions: []) => Promise<string>
    }
    installer.miseBin = '/fixture/mise'
    installer.isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
    let installed = false
    execFileAsync.mockImplementation(async (_file, args: string[]) => {
      if (args[0] === 'use') {
        const spec = args.at(-1)!
        const url = /url="([^"]+)"/.exec(spec)?.[1]?.replace('{{ version }}', '2.1.239')
        const publishedUrl =
          'https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases/2.1.239/win32-arm64/claude.exe'
        if (url !== publishedUrl || !spec.includes('bin="claude.exe"') || !spec.endsWith(`@${requested}`)) {
          throw new Error('404: no published Windows ARM64 artifact at the selected address')
        }
        installed = true
      }
      const stdout =
        args[0] === 'ls' && installed ? JSON.stringify({ claude: [{ version: '2.1.239', active: true }] }) : ''
      return { stdout, stderr: '' }
    })

    await expect(installer.installWithMise({ name: 'claude', tool: 'claude' }, requested, [])).resolves.toBe('2.1.239')
  })

  it.each([
    [true, 'x64'],
    [false, 'arm64'],
    [false, 'x64']
  ])('keeps the registry recipe on isWin=%s arch=%s', async (isWin, arch) => {
    platform.isWin = isWin
    Object.defineProperty(process, 'arch', { value: arch })
    const service = new BinaryManager()
    const installer = service as unknown as {
      miseBin: string
      isolatedEnv: { env: Record<string, string>; usesDefaultChinaPipIndex: boolean }
      installWithMise: (definition: { name: string; tool: string }, version: string, definitions: []) => Promise<string>
    }
    installer.miseBin = '/fixture/mise'
    installer.isolatedEnv = { env: {}, usesDefaultChinaPipIndex: false }
    execFileAsync.mockImplementation(async (_file, args: string[]) => {
      if (args[0] === 'use' && args.at(-1) !== 'claude@2.1.239') {
        throw new Error('An ARM64 Windows artifact cannot be installed on this platform')
      }
      return { stdout: JSON.stringify({ claude: [{ version: '2.1.239', active: true }] }), stderr: '' }
    })

    await expect(installer.installWithMise({ name: 'claude', tool: 'claude' }, '2.1.239', [])).resolves.toBe('2.1.239')
  })
})
