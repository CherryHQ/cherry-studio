import { createHash } from 'node:crypto'

import { net } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { claudeNpmRegistries, resolveClaudeNpmPackage } from '../claudeNpm'

const PACKAGE_NAME = '@anthropic-ai/claude-code-win32-arm64'
const PACKAGE_BYTES = Buffer.from('verified native ARM64 archive fixture')
const metadata = {
  name: PACKAGE_NAME,
  version: '2.1.312',
  dist: { integrity: `sha512-${createHash('sha512').update(PACKAGE_BYTES).digest('base64')}` }
}

beforeEach(() => {
  vi.mocked(net.fetch).mockReset().mockResolvedValue(Response.json(metadata))
})

describe('Claude npm platform package', () => {
  it.each(['latest', '2.1.312'])(
    'resolves %s to a verified native archive without an npm launcher',
    async (requested) => {
      const result = await resolveClaudeNpmPackage('https://registry.npmmirror.com/', requested)
      expect(result.version).toBe('2.1.312')
      const url = JSON.parse(/url=("[^"]+")/.exec(result.toolSpec)![1])
      expect(url).toBe(
        'https://registry.npmmirror.com/@anthropic-ai/claude-code-win32-arm64/-/claude-code-win32-arm64-{{ version }}.tgz'
      )
      expect(result.toolSpec).toContain('bin="claude.exe"')
      expect(result.toolSpec).toContain(`checksum="sha512:${createHash('sha512').update(PACKAGE_BYTES).digest('hex')}"`)
      expect(result.toolSpec).toContain('strip_components=1')
      expect(result.toolSpec).not.toContain('storage.googleapis.com')
    }
  )

  it.each([
    { ...metadata, name: '@anthropic-ai/claude-code-win32-x64' },
    { ...metadata, version: '2.1.311' },
    { ...metadata, version: '../../outside' }
  ])('rejects a package that does not match the requested platform/version', async (invalid) => {
    vi.mocked(net.fetch).mockResolvedValue(Response.json(invalid))
    await expect(resolveClaudeNpmPackage('https://registry.npmjs.org', '2.1.312')).rejects.toThrow('does not match')
  })

  it('uses the alternate public registry without overriding a custom source', () => {
    expect(claudeNpmRegistries('https://registry.npmmirror.com/')).toEqual([
      'https://registry.npmmirror.com',
      'https://registry.npmjs.org'
    ])
    expect(claudeNpmRegistries()).toEqual(['https://registry.npmjs.org', 'https://registry.npmmirror.com'])
    expect(claudeNpmRegistries('https://packages.example.test/npm/')).toEqual(['https://packages.example.test/npm'])
  })

  it.each([undefined, 'sha256-deadbeef', 'sha512-invalid'])(
    'rejects an absent or invalid integrity %s',
    async (integrity) => {
      vi.mocked(net.fetch).mockResolvedValue(Response.json({ ...metadata, dist: { integrity } }))
      await expect(resolveClaudeNpmPackage('https://registry.npmjs.org', 'latest')).rejects.toThrow('SHA-512')
    }
  )

  it('reports an unavailable platform package instead of installing an unverified executable', async () => {
    vi.mocked(net.fetch).mockResolvedValue(new Response(null, { status: 404 }))
    await expect(resolveClaudeNpmPackage('https://registry.npmjs.org', 'latest')).rejects.toThrow('HTTP 404')
  })
})
