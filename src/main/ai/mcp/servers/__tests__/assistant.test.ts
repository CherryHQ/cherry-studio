/**
 * Regression for mcp-servers-3: read_source's sensitive-file blocklist must cover all
 * dotenv variants and private-key/cert material, not just `.env`/`.env.local`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  preferenceGet: vi.fn()
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

import AssistantServer, { isAllowedAssistantNavigationPath, isBlockedSourceFile } from '../assistant'

beforeEach(() => {
  mocks.preferenceGet.mockReset()
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
    expect(isAllowedAssistantNavigationPath('/')).toBe(true)
    expect(isAllowedAssistantNavigationPath('/agents')).toBe(true)
    expect(isAllowedAssistantNavigationPath('/agents/assistant-1')).toBe(true)
    expect(isAllowedAssistantNavigationPath('/settings/provider')).toBe(true)
  })

  it('blocks removed routes and prefix lookalikes', () => {
    expect(isAllowedAssistantNavigationPath('/openclaw')).toBe(false)
    expect(isAllowedAssistantNavigationPath('/store')).toBe(false)
    expect(isAllowedAssistantNavigationPath('/app/library')).toBe(false)
    expect(isAllowedAssistantNavigationPath('/agents-legacy')).toBe(false)
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
