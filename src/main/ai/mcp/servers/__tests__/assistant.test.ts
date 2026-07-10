/**
 * Regression for mcp-servers-3: read_source's sensitive-file blocklist must cover all
 * dotenv variants and private-key/cert material, not just `.env`/`.env.local`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  preferenceGet: vi.fn(),
  mcpList: vi.fn()
}))

vi.mock('@application', () => ({
  application: {
    get: vi.fn((name: string) => {
      if (name === 'PreferenceService') return { get: mocks.preferenceGet }
      throw new Error(`Unexpected application.get(${name})`)
    }),
    getPath: vi.fn()
  }
}))

vi.mock('@data/services/McpServerService', () => ({
  mcpServerService: { list: mocks.mcpList }
}))

import AssistantServer, { isAllowedAssistantNavigationPath, isBlockedSourceFile } from '../assistant'

beforeEach(() => {
  mocks.preferenceGet.mockReset()
  mocks.mcpList.mockReset()
  mocks.mcpList.mockReturnValue({ items: [] })
})

describe('isBlockedSourceFile', () => {
  it('blocks every dotenv variant (except the .env.example template)', () => {
    for (const name of ['.env', '.env.local', '.env.production', '.env.development.local', '.ENV', '.Env.Staging']) {
      expect(isBlockedSourceFile(name)).toBe(true)
    }
    expect(isBlockedSourceFile('.env.example')).toBe(false)
  })

  it('blocks credentials and SSH private keys', () => {
    for (const name of ['credentials.json', 'id_rsa', 'id_dsa', 'id_ed25519', 'id_ecdsa']) {
      expect(isBlockedSourceFile(name)).toBe(true)
    }
  })

  it('blocks private-key / cert material by extension (case-insensitive)', () => {
    for (const name of ['server.key', 'cert.pem', 'bundle.p12', 'store.PFX']) {
      expect(isBlockedSourceFile(name)).toBe(true)
    }
  })

  it('allows ordinary source files', () => {
    for (const name of ['index.ts', 'README.md', 'package.json', 'env.ts']) {
      expect(isBlockedSourceFile(name)).toBe(false)
    }
  })
})

describe('isAllowedAssistantNavigationPath', () => {
  it('allows exact routes and nested routes only', () => {
    expect(isAllowedAssistantNavigationPath('/app/agents')).toBe(true)
    expect(isAllowedAssistantNavigationPath('/app/agents/assistant-1')).toBe(true)
    expect(isAllowedAssistantNavigationPath('/app/mini-app/example')).toBe(true)
    expect(isAllowedAssistantNavigationPath('/app/chat')).toBe(true)
    expect(isAllowedAssistantNavigationPath('/settings/provider')).toBe(true)
  })

  it('blocks removed routes and prefix lookalikes', () => {
    expect(isAllowedAssistantNavigationPath('/')).toBe(false)
    expect(isAllowedAssistantNavigationPath('/store')).toBe(false)
    expect(isAllowedAssistantNavigationPath('/app')).toBe(false)
    expect(isAllowedAssistantNavigationPath('/app/library')).toBe(false)
    expect(isAllowedAssistantNavigationPath('/app/openclaw')).toBe(false)
    expect(isAllowedAssistantNavigationPath('/openclaw')).toBe(false)
    expect(isAllowedAssistantNavigationPath('/agents')).toBe(false)
    expect(isAllowedAssistantNavigationPath('/agents-legacy')).toBe(false)
  })
})

describe('diagnose mcp_status', () => {
  it('redacts authenticated MCP URLs to origin only', () => {
    mocks.mcpList.mockReturnValue({
      items: [
        {
          id: 'private-mcp',
          name: 'Private MCP',
          type: 'streamableHttp',
          isActive: true,
          command: undefined,
          baseUrl: 'https://user:password@mcp.example:8443/api?token=secret#fragment'
        }
      ]
    })

    const server = new AssistantServer()
    const result = (
      server as unknown as { diagnoseMcpStatus: () => { content: Array<{ text: string }> } }
    ).diagnoseMcpStatus()
    const text = result.content[0].text
    const status = JSON.parse(text) as { servers: Array<{ baseUrl?: string }> }

    expect(status.servers[0]?.baseUrl).toBe('https://mcp.example:8443')
    expect(text).not.toContain('user')
    expect(text).not.toContain('password')
    expect(text).not.toContain('/api')
    expect(text).not.toContain('token=secret')
  })
})

describe('diagnose config', () => {
  it('redacts assistant-visible proxy values to origin only', async () => {
    mocks.preferenceGet.mockImplementation((key: string) => {
      if (key === 'app.proxy.url') return 'http://user:pass@proxy.example:8080/path?token=secret'
      return undefined
    })

    const server = new AssistantServer()
    const result = await (
      server as unknown as {
        diagnoseConfig: () => Promise<{ content: Array<{ text: string }> }>
      }
    ).diagnoseConfig()
    const text = result.content[0].text
    const config = JSON.parse(text) as { proxy?: string }

    expect(config.proxy).toBe('http://proxy.example:8080')
    expect(text).not.toContain('user')
    expect(text).not.toContain('pass')
    expect(text).not.toContain('token=secret')
    expect(text).not.toContain('/path')
  })
})
