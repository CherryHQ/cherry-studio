import { describe, expect, it } from 'vitest'

import { resolveSandboxPolicy, type SandboxOverlay } from '@main/ai/toolApproval/sandboxPolicy'

import { toClaudeCodeSandboxSettings } from '../sandboxSettings'

const home = '/Users/probe'

function settingsFor(overlay: SandboxOverlay) {
  const policy = resolveSandboxPolicy(overlay, 'darwin', home)
  if (!policy) throw new Error('expected a sandbox policy on darwin')
  return toClaudeCodeSandboxSettings(policy)
}

describe('resolveSandboxPolicy', () => {
  it('gives no sandbox to an Agent without an overlay', () => {
    expect(resolveSandboxPolicy(undefined, 'darwin', home)).toBeUndefined()
  })

  it.each(['linux', 'win32'] as const)('gives no sandbox on %s', (platform) => {
    expect(resolveSandboxPolicy({}, platform, home)).toBeUndefined()
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
