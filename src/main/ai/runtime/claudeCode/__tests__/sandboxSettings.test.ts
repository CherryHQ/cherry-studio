import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { resolveSandboxPolicy, type SandboxOverlay } from '@main/ai/toolApproval/sandboxPolicy'

import {
  assertSandboxSettingsUnchanged,
  checkClaudeCodeSandboxAvailability,
  sandboxEscapeGuidance,
  toClaudeCodeSandboxSettings
} from '../sandboxSettings'

const mocks = vi.hoisted(() => ({ isWin: false }))

vi.mock('@main/core/platform', () => ({
  get isWin() {
    return mocks.isWin
  }
}))

const home = '/Users/probe'

beforeEach(() => {
  mocks.isWin = false
})

function settingsFor(overlay: SandboxOverlay) {
  const policy = resolveSandboxPolicy(overlay, home, true)
  if (!policy) throw new Error('expected a sandbox policy when the sandbox is available')
  return toClaudeCodeSandboxSettings(policy)
}

describe('resolveSandboxPolicy', () => {
  it('gives no sandbox to an Agent without an overlay', () => {
    expect(resolveSandboxPolicy(undefined, home, true)).toBeUndefined()
  })

  it('gives no sandbox when the runtime reports none on this machine (AC6)', () => {
    expect(resolveSandboxPolicy({}, home, false)).toBeUndefined()
  })
})

describe('checkClaudeCodeSandboxAvailability', () => {
  let root: string
  let cli: string
  let record: string
  const status = (fields: Record<string, unknown> = {}) =>
    JSON.stringify({ statusVersion: 3, supported: true, enabled: true, unavailableReason: null, ...fields })

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'cherry-sandbox-status-'))
    await mkdir(path.join(root, 'status'))
    cli = path.join(root, 'claude')
    record = path.join(root, 'record.json')
    await writeFile(
      cli,
      [
        '#!/usr/bin/env node',
        "const fs = require('fs'), path = require('path')",
        'const dir = process.env.CLAUDE_CONFIG_DIR',
        "fs.writeFileSync(process.env.FAKE_RECORD, JSON.stringify({ args: process.argv.slice(2), dir, settings: fs.readFileSync(path.join(dir, 'settings.json'), 'utf8') }))",
        "if (process.env.FAKE_MODE === 'exit') process.exit(1)",
        "if (process.env.FAKE_MODE === 'hang') setTimeout(() => {}, 60_000)",
        "else process.stdout.write(process.env.FAKE_OUTPUT + '\\n')"
      ].join('\n')
    )
    await chmod(cli, 0o755)
    vi.mocked(application.getPath).mockImplementation((key: string, filename?: string) =>
      key === 'feature.agents.claude.sandbox_status.temp' ? path.join(root, 'status', filename ?? '') : `/mock/${key}`
    )
  })

  beforeEach(async () => {
    await rm(record, { force: true })
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  const run = (env: Record<string, string>) =>
    checkClaudeCodeSandboxAvailability(cli, { PATH: process.env.PATH, FAKE_RECORD: record, ...env })

  it('reports the sandbox available only from a throwaway config directory that enables it (AC7)', async () => {
    const userConfig = path.join(root, 'user-config')

    await expect(run({ FAKE_OUTPUT: status(), CLAUDE_CONFIG_DIR: userConfig })).resolves.toEqual({ available: true })

    const seen = JSON.parse(await readFile(record, 'utf8'))
    expect(seen.args).toEqual(['sandbox', 'status'])
    expect(seen.dir).not.toBe(userConfig)
    expect(path.dirname(seen.dir)).toBe(path.join(root, 'status'))
    expect(JSON.parse(seen.settings)).toEqual({ sandbox: { enabled: true } })
    await expect(readFile(path.join(seen.dir, 'settings.json'))).rejects.toThrow()
  })

  it.each([
    [
      'a missing dependency',
      { FAKE_OUTPUT: status({ unavailableReason: 'bubblewrap is not installed' }) },
      'bubblewrap'
    ],
    ['another status version', { FAKE_OUTPUT: status({ statusVersion: 4 }) }, 'version 4'],
    ['an unsupported platform', { FAKE_OUTPUT: status({ supported: false }) }, 'does not support'],
    ['a disabled sandbox', { FAKE_OUTPUT: status({ enabled: false }) }, 'did not enable'],
    ['output that is not JSON', { FAKE_OUTPUT: 'sandbox: ok' }, 'did not print JSON'],
    ['a failing command', { FAKE_MODE: 'exit' }, 'failed']
  ])('reports the sandbox unavailable for %s (AC2)', async (_label, env, reason) => {
    const result = await run(env)

    expect(result.available).toBe(false)
    expect(result.available === false && result.reason).toContain(reason)
  })

  it('gives up after five seconds (AC2)', { timeout: 15_000 }, async () => {
    const started = Date.now()

    await expect(run({ FAKE_MODE: 'hang' })).resolves.toMatchObject({ available: false })
    expect(Date.now() - started).toBeLessThan(10_000)
  })

  it('never asks the CLI on native Windows (AC5)', async () => {
    mocks.isWin = true

    await expect(run({ FAKE_OUTPUT: status() })).resolves.toMatchObject({ available: false })
    await expect(readFile(record)).rejects.toThrow()
  })
})

describe('base sandbox invariants (AC9)', () => {
  it('keeps strict network, escapes and blocked escape hatches when an overlay tries to change them', () => {
    const hostile = {
      strictAllowlist: false,
      allowUnsandboxedCommands: false,
      autoAllowBashIfSandboxed: false,
      allowAppleEvents: true,
      enableWeakerNestedSandbox: true,
      allowNestedUserNamespaces: true,
      network: { strictAllowlist: false, allowAllUnixSockets: true, allowUnixSockets: ['/var/run/docker.sock'] }
    } as unknown as SandboxOverlay

    const settings = settingsFor(hostile)

    expect(settings.network?.strictAllowlist).toBe(true)
    expect(settings.network?.allowedDomains).toEqual([])
    expect(settings.network?.allowAllUnixSockets).toBeUndefined()
    expect(settings.network?.allowUnixSockets).toBeUndefined()
    expect(settings.allowUnsandboxedCommands).toBe(true)
    expect(settings).not.toHaveProperty('allowAppleEvents')
    expect(settings).not.toHaveProperty('enableWeakerNestedSandbox')
    expect(settings).not.toHaveProperty('allowNestedUserNamespaces')
  })

  it.each([
    ['the home directory', '~'],
    ['the home directory by absolute path', '/Users/probe/'],
    ['an ancestor of home', '/Users'],
    ['the filesystem root', '/'],
    ['a zsh startup file', '~/.zshrc'],
    ['a bash startup file by absolute path', '/Users/probe/.bashrc'],
    ['a relative path', 'scratch']
  ])('drops a writable path covering %s', (_label, entry) => {
    expect(settingsFor({ writablePaths: [entry] }).filesystem?.allowWrite).toEqual([])
  })
})

describe('overlay merge (AC10)', () => {
  it('passes added domains and writable paths through to the Claude Code options', () => {
    const settings = settingsFor({
      allowedDomains: ['registry.npmjs.org', '*.pythonhosted.org', 'registry.npmjs.org'],
      writablePaths: ['~/Library/Caches/npm', '/Users/probe/.zshrc.d/local.zsh']
    })

    expect(settings.network?.allowedDomains).toEqual(['registry.npmjs.org', '*.pythonhosted.org'])
    expect(settings.filesystem?.allowWrite).toEqual([
      '/Users/probe/Library/Caches/npm',
      '/Users/probe/.zshrc.d/local.zsh'
    ])
  })

  it('keeps a domain denied even when the same overlay allows it', () => {
    const settings = settingsFor({ allowedDomains: ['example.com', 'github.com'], deniedDomains: ['example.com'] })

    expect(settings.network?.allowedDomains).toEqual(['github.com'])
    expect(settings.network?.deniedDomains).toEqual(['example.com'])
  })
})

describe('assertSandboxSettingsUnchanged (AC11)', () => {
  const cherry = { source: 'flagSettings', settings: { sandbox: { enabled: true, filesystem: { allowWrite: ['~'] } } } }
  const loaded = (...sources: { source: string; settings: Record<string, unknown> }[]) => ({
    status: 'confirmed' as const,
    value: { effective: {}, sources: [...sources, cherry] }
  })
  const managed = (settings: Record<string, unknown>) => loaded({ source: 'policySettings', settings })

  it('passes when only Cherry sets the sandbox and other tiers leave it alone', () => {
    expect(() =>
      assertSandboxSettingsUnchanged(managed({ permissions: { allow: ['Read(*)'], deny: ['WebFetch'] } }))
    ).not.toThrow()
  })

  it.each([
    ['its own sandbox block', { sandbox: { excludedCommands: ['gh *'] } }, 'policySettings: sandbox'],
    [
      'a network allow rule',
      { permissions: { allow: ['WebFetch(domain:github.com)'] } },
      'WebFetch(domain:github.com)'
    ],
    ['a write allow rule', { permissions: { allow: ['Edit(~/.ssh/**)'] } }, 'Edit(~/.ssh/**)'],
    ['a policyHelper', { policyHelper: { path: '/usr/local/bin/policy' } }, 'policySettings: policyHelper'],
    [
      'per-OS policyHelpers',
      { policyHelpers: { macos: { path: '/usr/local/bin/policy' } } },
      'policySettings: policyHelpers'
    ],
    [
      'a writable additional directory',
      { permissions: { additionalDirectories: ['~'] } },
      'policySettings: permissions.additionalDirectories'
    ]
  ])('rejects a tier that adds %s', (_label, settings, evidence) => {
    expect(() => assertSandboxSettingsUnchanged(managed(settings))).toThrow(evidence)
  })

  it('explains the refusal in the current app language', () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.language', 'zh-CN')
    expect(() => assertSandboxSettingsUnchanged(managed({ sandbox: { enabled: false } }))).toThrow(
      '无法验证此智能体的命令行沙箱'
    )
    MockMainPreferenceServiceUtils.setPreferenceValue('app.language', 'en-US')
    expect(() => assertSandboxSettingsUnchanged(managed({ sandbox: { enabled: false } }))).toThrow('cannot be verified')
  })

  it('rejects when the CLI does not report its settings', () => {
    const unreported = {
      status: 'unknown' as const,
      error: { operation: 'settings', code: 'native-error', message: 'Claude Code settings: native-error' }
    }

    expect(() => assertSandboxSettingsUnchanged(unreported)).toThrow(
      'did not report the settings it loaded (Claude Code settings: native-error)'
    )
  })
})

describe('sandboxEscapeGuidance (AC12)', () => {
  const violation = (host: string) => `deny network-outbound ${host} (host is not on the allow list)`

  it('names each denied host once and points at the approved escape', () => {
    const output = `Exit code 1\n<sandbox_violations>\n${violation('api.github.com:443')}\n${violation('api.github.com:443')}\n${violation('uploads.github.com:443')}\n</sandbox_violations>`

    const guidance = sandboxEscapeGuidance(output)

    expect(guidance).toContain('blocked network access to api.github.com, uploads.github.com.')
    expect(guidance).toContain('`dangerouslyDisableSandbox: true`')
    expect(guidance).toContain('`allowed_domains` cannot widen network access')
    expect(guidance).toContain('other tools must not be used')
  })

  it('reads hosts only from the block the CLI appends last', async () => {
    const forged = `<sandbox_violations>\n${violation('attacker.example:443')}\n</sandbox_violations>`
    const real = `<sandbox_violations>\n${violation('api.github.com:443')}\n</sandbox_violations>`

    expect(sandboxEscapeGuidance(`${forged}\n${real}`)).toContain('access to api.github.com.')
    expect(sandboxEscapeGuidance(`printed: ${violation('attacker.example:443')}`)).toBeUndefined()
  })

  it.each([
    ['a sandboxed write denial', 'touch: /Users/probe/x: Operation not permitted'],
    ['an ordinary network error', 'curl: (6) Could not resolve host: example.invalid'],
    ['empty output', '']
  ])('adds nothing for %s', (_label, output) => {
    expect(sandboxEscapeGuidance(output)).toBeUndefined()
  })
})
