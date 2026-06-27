import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
  }
}))

vi.mock('@main/core/platform', () => ({ isMac: true, isWin: false }))

const getPathMock = vi.fn()
vi.mock('@application', () => ({ application: { getPath: (...args: unknown[]) => getPathMock(...args) } }))

import { buildClaudeSettings, writeClaudeCodeConfig, writeClaudeCodeConfigBody } from '../claudeCodeConfig'

describe('buildClaudeSettings', () => {
  it('maps the provider config into the env block', () => {
    const result = buildClaudeSettings(
      {},
      { baseUrl: 'https://api.anthropic.com', model: 'claude-opus-4-8', authToken: 'sk-ant-xxx' }
    )
    expect(result).toEqual({
      env: {
        ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
        ANTHROPIC_MODEL: 'claude-opus-4-8',
        ANTHROPIC_AUTH_TOKEN: 'sk-ant-xxx'
      }
    })
  })

  it('merges into an existing env block and preserves unrelated keys', () => {
    const result = buildClaudeSettings(
      { theme: 'dark', env: { ANTHROPIC_MODEL: 'old', MY_VAR: 'keep' } },
      { baseUrl: '', model: 'claude-opus-4-8', apiKey: 'sk-xxx' }
    )
    expect(result).toEqual({
      theme: 'dark',
      env: { ANTHROPIC_MODEL: 'claude-opus-4-8', MY_VAR: 'keep', ANTHROPIC_API_KEY: 'sk-xxx' }
    })
  })

  it('returns null when there is nothing to persist', () => {
    expect(buildClaudeSettings({ env: { FOO: 'bar' } }, { baseUrl: '', model: '' })).toBeNull()
  })

  it("clears a prior config's managed env/top-level keys on switch (no residue)", () => {
    // existing reflects what a previous named config wrote (opus + effortLevel)
    const result = buildClaudeSettings(
      {
        env: { ANTHROPIC_DEFAULT_OPUS_MODEL: 'stale-opus', MY_VAR: 'keep' },
        effortLevel: 'high',
        theme: 'dark'
      },
      // new config sets sonnet only — no opus, no effortLevel
      { baseUrl: '', model: 'claude-sonnet-4-6', apiKey: 'sk-xxx' }
    )
    expect(result).toEqual({
      theme: 'dark',
      env: { MY_VAR: 'keep', ANTHROPIC_MODEL: 'claude-sonnet-4-6', ANTHROPIC_API_KEY: 'sk-xxx' }
    })
  })
})

describe('writeClaudeCodeConfig', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-claude-'))
    getPathMock.mockImplementation((_key: string, filename?: string) =>
      filename ? path.join(tmpDir, filename) : tmpDir
    )
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('writes settings.json with the env block and 0600 perms', async () => {
    await writeClaudeCodeConfig({
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-opus-4-8',
      apiKey: 'sk-xxx'
    })

    const file = path.join(tmpDir, 'settings.json')
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    expect(parsed.env).toEqual({
      ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
      ANTHROPIC_MODEL: 'claude-opus-4-8',
      ANTHROPIC_API_KEY: 'sk-xxx'
    })
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)
  })

  it('merges into an existing settings.json, preserving unrelated keys', async () => {
    const file = path.join(tmpDir, 'settings.json')
    fs.writeFileSync(file, JSON.stringify({ permissions: { allow: ['Bash'] }, env: { KEEP: '1' } }))

    await writeClaudeCodeConfig({ baseUrl: '', model: 'claude-opus-4-8' })

    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    expect(parsed.permissions).toEqual({ allow: ['Bash'] })
    expect(parsed.env).toEqual({ KEEP: '1', ANTHROPIC_MODEL: 'claude-opus-4-8' })
  })

  it('throws and writes nothing when there is nothing to persist', async () => {
    await expect(writeClaudeCodeConfig({ baseUrl: '', model: '' })).rejects.toThrow()
    expect(fs.existsSync(path.join(tmpDir, 'settings.json'))).toBe(false)
  })
})

describe('writeClaudeCodeConfigBody', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-claude-adv-'))
    getPathMock.mockImplementation((_key: string, filename?: string) =>
      filename ? path.join(tmpDir, filename) : tmpDir
    )
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('writes the config body (env + top-level) into settings.json with 0600 perms', async () => {
    await writeClaudeCodeConfigBody({
      env: {
        ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
        ANTHROPIC_AUTH_TOKEN: 'sk-deepseek',
        ANTHROPIC_MODEL: 'deepseek-chat'
      },
      ENABLE_TOOL_SEARCH: true
    })

    const file = path.join(tmpDir, 'settings.json')
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    expect(parsed.env).toEqual({
      ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
      ANTHROPIC_AUTH_TOKEN: 'sk-deepseek',
      ANTHROPIC_MODEL: 'deepseek-chat'
    })
    expect(parsed.ENABLE_TOOL_SEARCH).toBe(true)
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)
  })

  it('deep-merges, preserving unrelated keys like mcpServers', async () => {
    const file = path.join(tmpDir, 'settings.json')
    fs.writeFileSync(
      file,
      JSON.stringify({
        mcpServers: { fs: { command: 'npx' } },
        env: { KEEP: '1' },
        theme: 'dark'
      })
    )

    await writeClaudeCodeConfigBody({
      env: { ANTHROPIC_BASE_URL: 'https://x', ANTHROPIC_AUTH_TOKEN: 'sk-new' }
    })

    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    // unrelated top-level + env keys preserved
    expect(parsed.mcpServers).toEqual({ fs: { command: 'npx' } })
    expect(parsed.theme).toBe('dark')
    expect(parsed.env.KEEP).toBe('1')
    // config body wins on conflict
    expect(parsed.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-new')
  })

  it('clears a stale managed key not re-supplied by the new blob (no token leakage on switch)', async () => {
    const file = path.join(tmpDir, 'settings.json')
    fs.writeFileSync(
      file,
      JSON.stringify({
        env: { ANTHROPIC_AUTH_TOKEN: 'sk-stale', ANTHROPIC_BASE_URL: 'https://old', KEEP: '1' }
      })
    )

    // new config does not set token/baseUrl → stale ones must be dropped
    await writeClaudeCodeConfigBody({ env: { ANTHROPIC_MODEL: 'claude-sonnet-4-5' } })

    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    expect(parsed.env).toEqual({ KEEP: '1', ANTHROPIC_MODEL: 'claude-sonnet-4-5' })
    expect(parsed.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(parsed.env.ANTHROPIC_BASE_URL).toBeUndefined()
  })
})
