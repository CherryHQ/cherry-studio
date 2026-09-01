// oxlint-disable typescript/no-unnecessary-type-assertion -- tsgolint 7 false-positives vs tsc 7 (see #17746)
import type { ChildProcess } from 'node:child_process'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const crossSpawnMock = vi.hoisted(() => vi.fn())

// The cross-spawn boundary owns Windows batch-shim invocation and argument quoting.
vi.mock('cross-spawn', () => ({ default: crossSpawnMock }))

vi.mock('@application', () => ({ application: { getPath: vi.fn() } }))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() })
  }
}))

vi.mock('@main/utils/shellEnv', () => ({ getShellEnv: vi.fn() }))

import { crossPlatformSpawn, removeEnvProxy } from '../processRunner'

describe('removeEnvProxy', () => {
  it('removes every Cherry proxy variable case-insensitively while preserving other entries', () => {
    const env: NodeJS.ProcessEnv = {
      CHERRY_STUDIO_NODE_PROXY_RULES: 'http://user:password@proxy.example',
      cherry_studio_node_proxy_bypass_rules: 'localhost',
      Http_Proxy: 'http://proxy.example',
      HTTPS_PROXY: 'http://proxy.example',
      All_Proxy: 'socks5://proxy.example',
      socks_proxy: 'socks5://proxy.example',
      No_Proxy: 'localhost',
      GRPC_PROXY: 'http://proxy.example',
      Path: 'C:\\Windows\\System32',
      USER_DEFINED_TOKEN: 'preserve-me'
    }

    removeEnvProxy(env)

    expect(env).toEqual({ Path: 'C:\\Windows\\System32', USER_DEFINED_TOKEN: 'preserve-me' })
  })
})

describe('crossPlatformSpawn (Windows batch shims)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    crossSpawnMock.mockReturnValue({} as ChildProcess)
  })

  it.each(['cmd', 'bat'])('delegates a .%s executable and opaque arguments without enabling a shell', (extension) => {
    const args = ['rewrite', 'echo "quoted" & whoami %PATH%']
    const env = { Path: 'C:\\Windows\\System32' }
    const command = `C:\\Users\\V\\AppData\\Roaming\\npm\\rtk.${extension}`

    crossPlatformSpawn(command, args, { env })

    expect(crossSpawnMock).toHaveBeenCalledWith(
      command,
      args,
      expect.objectContaining({ env, stdio: 'pipe', windowsHide: true })
    )
    expect(crossSpawnMock.mock.calls[0][2]).not.toHaveProperty('shell')
  })
})
