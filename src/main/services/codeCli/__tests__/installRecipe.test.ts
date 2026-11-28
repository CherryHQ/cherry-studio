import { describe, expect, it } from 'vitest'

import { CODE_CLI_TOOL_PRESET_BY_EXECUTABLE } from '@shared/data/presets/codeCliTools'

import { resolveInstallRecipe, resolveCliInstallRecipe } from '../installRecipe'

const registry = (id: string, distribution: unknown) => ({ agents: [{ id, distribution }] })

describe('system agent install recipes', () => {
  it('uses official Kiro, Trae and Vibe installers without requiring registry entries', () => {
    expect(resolveInstallRecipe('kiro', undefined, 'darwin')).toMatchObject({
      manager: 'script',
      command: 'bash',
      args: ['-o', 'pipefail', '-c', 'curl -fsSL https://cli.kiro.dev/install | bash']
    })
    expect(resolveInstallRecipe('trae', undefined, 'linux')).toMatchObject({
      manager: 'script',
      args: ['-o', 'pipefail', '-c', 'curl -fsSL https://trae.cn/trae-cli/install_v2.sh | bash']
    })
    expect(resolveInstallRecipe('trae', undefined, 'win32')).toMatchObject({
      manager: 'script',
      command: 'powershell.exe'
    })
    expect(resolveInstallRecipe('kiro', undefined, 'win32')).toBeUndefined()
    expect(resolveInstallRecipe('mistral-vibe')).toEqual({
      manager: 'uv',
      package: 'mistral-vibe',
      args: ['tool', 'install', '--upgrade', 'mistral-vibe']
    })
  })
  it.each([
    ['codebuddy-code', '@tencent-ai/codebuddy-code'],
    ['command-code', 'command-code'],
    ['deepagents', 'deepagents-acp'],
    ['deepseek-harness', '@deepseek-ai/dsh'],
    ['dimagent', 'dimcode'],
    ['openclaw', 'openclaw'],
    ['omp', '@oh-my-pi/pi-coding-agent'],
    ['qoder', '@qodercn-ai/qoderclicn'],
    ['qoder-global', '@qoder-ai/qodercli'],
    ['snow', 'snow-ai'],
    ['zcode', 'zcode-acp-server']
  ])('installs %s from its published package without an ACP registry entry', (id, packageName) => {
    expect(resolveInstallRecipe(id)).toEqual({
      manager: 'npm',
      package: packageName,
      args: ['install', '--global', packageName]
    })
  })

  it('uses the published Auggie package instead of the outdated ACP registry version', () => {
    const staleRegistry = registry('auggie', { npx: { package: '@augmentcode/auggie@0.37.0' } })
    expect(resolveInstallRecipe('auggie', staleRegistry)).toMatchObject({ package: '@augmentcode/auggie' })
  })

  it('uses the current DeepAgents npm package when the ACP registry pins an older version', () => {
    const staleRegistry = registry('deepagents', { npx: { package: 'deepagents-acp@0.1.7' } })
    expect(resolveInstallRecipe('deepagents', staleRegistry)).toMatchObject({ package: 'deepagents-acp' })
  })

  it('installs the MiniMax package that provides mcode instead of the registry launcher', () => {
    const launcher = registry('minimax-code', { npx: { package: '@minimax-ai/code-acp@0.7.8' } })
    expect(resolveInstallRecipe('minimax', launcher)).toEqual({
      manager: 'npm',
      package: '@minimax-ai/code',
      args: ['install', '--global', '@minimax-ai/code']
    })
  })

  it('installs Kimi Code instead of the retired Kimi package in the ACP registry', () => {
    const expected = { manager: 'npm', package: '@moonshot-ai/kimi-code' }
    expect(resolveInstallRecipe('kimi', registry('kimi', { uvx: { package: 'kimi-cli' } }))).toMatchObject(expected)
    expect(resolveInstallRecipe('kimi', undefined)).toMatchObject(expected)
    expect(resolveCliInstallRecipe(CODE_CLI_TOOL_PRESET_BY_EXECUTABLE.kimi!)).toMatchObject(expected)
  })

  it.each(['gemini', 'fast-agent', 'stakpak', 'vtcode'])(
    'rejects removed preset %s even when it remains in the registry',
    (id) => {
      expect(() => resolveInstallRecipe(id, registry(id, { npx: { package: 'retired-agent' } }))).toThrow(
        'Unknown local agent preset'
      )
    }
  )

  it('turns registry runners into persistent installation, without passing ACP launch arguments', () => {
    expect(
      resolveInstallRecipe('kilo', registry('kilo', { npx: { package: '@kilocode/cli@7.8.1', args: ['--acp'] } }))
    ).toEqual({
      manager: 'npm',
      package: '@kilocode/cli@7.8.1',
      args: ['install', '--global', '@kilocode/cli@7.8.1']
    })
    expect(
      resolveInstallRecipe('junie', registry('junie', { uvx: { package: 'fixture-agent==1.2.3', args: ['-x'] } }))
    ).toEqual({ manager: 'uv', package: 'fixture-agent==1.2.3', args: ['tool', 'install', 'fixture-agent==1.2.3'] })
  })

  it('uses native CLIs for native drivers, not incompatible ACP adapters', () => {
    expect(resolveInstallRecipe('claude', undefined)).toMatchObject({ package: '@anthropic-ai/claude-code' })
    expect(resolveInstallRecipe('codex', undefined)).toMatchObject({ package: '@openai/codex' })
  })

  it.each(['darwin', 'linux', 'win32'] as const)(
    'installs Hermes with its official noninteractive bootstrap on %s',
    (platform) => {
      const recipe = resolveInstallRecipe('hermes', undefined, platform)
      const command =
        platform === 'win32'
          ? "$ErrorActionPreference = 'Stop'; & ([scriptblock]::Create((irm https://hermes-agent.nousresearch.com/install.ps1))) -NonInteractive; if ($LASTEXITCODE) { exit $LASTEXITCODE }"
          : 'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash -s -- --non-interactive'
      expect(recipe).toEqual({
        manager: 'script',
        command: platform === 'win32' ? 'powershell.exe' : 'bash',
        args:
          platform === 'win32'
            ? ['-NoProfile', '-NonInteractive', '-Command', command]
            : ['-o', 'pipefail', '-c', command]
      })
      expect(resolveCliInstallRecipe(CODE_CLI_TOOL_PRESET_BY_EXECUTABLE.hermes!, undefined, platform)).toEqual(recipe)
      expect(() => resolveCliInstallRecipe(CODE_CLI_TOOL_PRESET_BY_EXECUTABLE.hermes!, '0.19.0', platform)).toThrow(
        'Hermes manages its own updates'
      )
    }
  )

  it('uses platform-specific official Antigravity installers', () => {
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
          id: 'junie',
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
    expect(resolveInstallRecipe('junie', manifest, 'darwin', 'arm64')).toMatchObject({
      manager: 'binary',
      archive: 'https://example.com/arm.zip',
      sha256: 'a'.repeat(64)
    })
    expect(resolveInstallRecipe('junie', manifest, 'win32', 'arm64')).toMatchObject({
      manager: 'binary',
      archive: 'https://example.com/windows.zip',
      cmd: './agent.exe'
    })
    const withWinArm64 = {
      agents: [
        {
          id: 'junie',
          version: '1.2.3',
          distribution: {
            binary: {
              'windows-aarch64': { archive: 'https://example.com/windows-arm64.zip', cmd: './agent-arm64.exe' },
              'windows-x86_64': { archive: 'https://example.com/windows.zip', cmd: './agent.exe' }
            }
          }
        }
      ]
    }
    expect(resolveInstallRecipe('junie', withWinArm64, 'win32', 'arm64')).toMatchObject({
      manager: 'binary',
      archive: 'https://example.com/windows-arm64.zip',
      cmd: './agent-arm64.exe'
    })
    expect(resolveInstallRecipe('junie', manifest, 'win32', 'x64')).toMatchObject({ cmd: './agent.exe' })
    expect(resolveInstallRecipe('junie', manifest, 'linux', 'x64')).toBeUndefined()
  })
})
