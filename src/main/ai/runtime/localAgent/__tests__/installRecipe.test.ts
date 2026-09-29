import { describe, expect, it } from 'vitest'

import { resolveInstallRecipe } from '../installRecipe'

const registry = (id: string, distribution: unknown) => ({ agents: [{ id, distribution }] })

describe('system agent install recipes', () => {
  it('turns registry runners into persistent installation, without passing ACP launch arguments', () => {
    expect(
      resolveInstallRecipe(
        'gemini',
        registry('gemini', { npx: { package: '@google/gemini-cli@0.61.0', args: ['--acp'] } })
      )
    ).toEqual({
      manager: 'npm',
      package: '@google/gemini-cli@0.61.0',
      args: ['install', '--global', '@google/gemini-cli@0.61.0']
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
    expect(() => resolveInstallRecipe('gemini', registry('gemini', { npx: { package: spec } }))).toThrow()
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
