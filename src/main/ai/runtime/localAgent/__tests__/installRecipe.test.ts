import { describe, expect, it } from 'vitest'

import { CODE_CLI_TOOL_PRESET_BY_EXECUTABLE } from '@shared/data/presets/codeCliTools'

import { resolveInstallRecipe, resolveCliInstallRecipe } from '../installRecipe'

const registry = (id: string, distribution: unknown) => ({ agents: [{ id, distribution }] })

describe('system agent install recipes', () => {
  it.each([
    ['omp', '@oh-my-pi/pi-coding-agent'],
    ['snow', 'snow-ai'],
    ['zcode', 'zcode-acp-server']
  ])('installs %s from its published package without an ACP registry entry', (id, packageName) => {
    expect(resolveInstallRecipe(id, undefined)).toEqual({
      manager: 'npm',
      package: packageName,
      args: ['install', '--global', packageName]
    })
  })

  it('installs Kimi Code instead of the retired Kimi package in the ACP registry', () => {
    const expected = { manager: 'npm', package: '@moonshot-ai/kimi-code' }
    expect(resolveInstallRecipe('kimi', registry('kimi', { uvx: { package: 'kimi-cli' } }))).toMatchObject(expected)
    expect(resolveInstallRecipe('kimi', undefined)).toMatchObject(expected)
    expect(resolveCliInstallRecipe(CODE_CLI_TOOL_PRESET_BY_EXECUTABLE.kimi!)).toMatchObject(expected)
  })

  it('rejects retired Gemini CLI installation even when it remains in the registry', () => {
    expect(() =>
      resolveInstallRecipe('gemini', registry('gemini', { npx: { package: '@google/gemini-cli' } }))
    ).toThrow('Unknown local agent preset')
  })

  it('turns registry runners into persistent installation, without passing ACP launch arguments', () => {
    expect(
      resolveInstallRecipe('kilo', registry('kilo', { npx: { package: '@kilocode/cli@7.8.1', args: ['--acp'] } }))
    ).toEqual({
      manager: 'npm',
      package: '@kilocode/cli@7.8.1',
      args: ['install', '--global', '@kilocode/cli@7.8.1']
    })
    expect(
      resolveInstallRecipe(
        'fast-agent',
        registry('fast-agent', { uvx: { package: 'fast-agent-acp==0.10.1', args: ['-x'] } })
      )
    ).toEqual({ manager: 'uv', package: 'fast-agent-acp==0.10.1', args: ['tool', 'install', 'fast-agent-acp==0.10.1'] })
  })

  it('uses native CLIs for native drivers, not incompatible ACP adapters', () => {
    expect(resolveInstallRecipe('claude', undefined)).toMatchObject({ package: '@anthropic-ai/claude-code' })
    expect(resolveInstallRecipe('codex', undefined)).toMatchObject({ package: '@openai/codex' })
  })

  it('keeps native Python extras and uses platform-specific official Antigravity installers', () => {
    expect(resolveInstallRecipe('hermes', undefined)).toEqual({
      manager: 'uv',
      package: 'hermes-agent[web]',
      args: ['tool', 'install', '--upgrade', 'hermes-agent[web]']
    })
    expect(resolveCliInstallRecipe(CODE_CLI_TOOL_PRESET_BY_EXECUTABLE.hermes!, '0.19.0')).toMatchObject({
      manager: 'uv',
      args: ['tool', 'install', '--upgrade', 'hermes-agent[web]==0.19.0']
    })
    const unix = resolveCliInstallRecipe(CODE_CLI_TOOL_PRESET_BY_EXECUTABLE.agy!, undefined, 'darwin')
    const windows = resolveCliInstallRecipe(CODE_CLI_TOOL_PRESET_BY_EXECUTABLE.agy!, undefined, 'win32')
    expect(unix).toMatchObject({ manager: 'script', command: 'bash' })
    expect(unix.args.join(' ')).toContain('https://antigravity.google/cli/install.sh')
    expect(windows).toMatchObject({ manager: 'script', command: 'powershell.exe' })
    expect(windows.args.join(' ')).toContain('https://antigravity.google/cli/install.ps1')
    expect(() => resolveCliInstallRecipe(CODE_CLI_TOOL_PRESET_BY_EXECUTABLE.agy!, '1.0.0')).toThrow()
  })

  it('maps preset identities to registry identities', () => {
    expect(
      resolveInstallRecipe('copilot', registry('github-copilot-cli', { npx: { package: '@github/copilot@1.0.0' } }))
        ?.manager
    ).toBe('npm')
    expect(
      resolveInstallRecipe('qwen', registry('qwen-code', { npx: { package: '@qwen-code/qwen-code@1.0.0' } }))?.manager
    ).toBe('npm')
  })

  it.each([
    '--prefix=/tmp',
    'https://example.com/pkg.tgz',
    'pkg;touch /tmp/marker',
    'git+https://example.com/repo',
    'pkg@latest\n--force'
  ])('rejects unsupported package specifications: %s', (spec) => {
    expect(() => resolveInstallRecipe('kilo', registry('kilo', { npx: { package: spec } }))).toThrow()
  })

  it('selects the matching binary architecture and preserves the integrity checksum', () => {
    const manifest = {
      agents: [
        {
          id: 'cursor',
          version: '1.2.3',
          distribution: {
            binary: {
              'darwin-aarch64': { archive: 'https://example.com/arm.zip', cmd: './bin/agent', sha256: 'a'.repeat(64) },
              'windows-x86_64': { archive: 'https://example.com/windows.zip', cmd: './agent.exe' }
            }
          }
        }
      ]
    }
    expect(resolveInstallRecipe('cursor', manifest, 'darwin', 'arm64')).toMatchObject({
      manager: 'binary',
      archive: 'https://example.com/arm.zip',
      sha256: 'a'.repeat(64)
    })
    expect(resolveInstallRecipe('cursor', manifest, 'win32', 'x64')).toMatchObject({ cmd: './agent.exe' })
    expect(resolveInstallRecipe('cursor', manifest, 'linux', 'x64')).toBeUndefined()
  })

  it('does not install a binary for an unsupported platform', () => {
    expect(resolveInstallRecipe('cursor', registry('cursor', { binary: {} }))).toBeUndefined()
  })
})
