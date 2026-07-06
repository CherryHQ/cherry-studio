/**
 * Regression for mcp-servers-3: read_source's sensitive-file blocklist must cover all
 * dotenv variants and private-key/cert material, not just `.env`/`.env.local`.
 */

import { describe, expect, it } from 'vitest'

import { isAllowedAssistantNavigationPath, isBlockedSourceFile } from '../assistant'

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
    expect(isAllowedAssistantNavigationPath('/store')).toBe(false)
    expect(isAllowedAssistantNavigationPath('/app/library')).toBe(false)
    expect(isAllowedAssistantNavigationPath('/agents-legacy')).toBe(false)
  })
})
