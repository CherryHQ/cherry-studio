import { describe, expect, it } from 'vitest'

import { detectGlobalInstall, detectMiseMutation } from '../dependencyGuard'

describe('detectGlobalInstall — identifies global/shared installs', () => {
  it.each([
    'npm i -g typescript',
    'npm install --global eslint',
    'pnpm add -g prettier',
    'bun add -g cowsay',
    'bun install --global vitest',
    'sudo npm install -g pm2',
    'NPM_CONFIG_PREFIX=/x npm i -g foo',
    'yarn global add serve',
    'uv tool install ruff',
    'pipx install black',
    'pip install --user requests',
    'pip3 install --break-system-packages numpy',
    'pip install --system flask',
    'uv pip install --system pandas',
    'cargo install ripgrep',
    'go install example.com/tool@latest',
    'gem install rubocop',
    'brew install jq',
    'sudo apt-get install jq',
    'dotnet tool install --global dotnetsay',
    'ls && npm i -g webpack'
  ])('flags: %s', (cmd) => {
    expect(detectGlobalInstall(cmd)).not.toBeNull()
  })
})

describe('detectGlobalInstall — allows project-local & ephemeral', () => {
  it.each([
    'bun install',
    'bun install lodash',
    'bun add zod',
    'npm install',
    'npm ci',
    'pnpm install',
    'uv pip install requests',
    'uv run python script.py',
    'uvx ruff check',
    'bun x cowsay hi',
    'npx tsc --noEmit',
    'mise registry fd',
    'mise ls --json',
    'mise which fd',
    'mise x -- fd --version',
    'cargo build',
    'go get example.com/library',
    'dotnet tool install --local dotnetsay',
    // `-g` only as a substring of a package name, not a standalone flag
    'bun add some-g-pkg',
    'rg --glob "*.ts" pattern'
  ])('allows: %s', (cmd) => {
    expect(detectGlobalInstall(cmd)).toBeNull()
    expect(detectMiseMutation(cmd)).toBeNull()
  })
})

describe('detectGlobalInstall — segment isolation', () => {
  it('does not flag when manager and flag are in different chained segments', () => {
    // `-g` here belongs to grep, not to npm install.
    expect(detectGlobalInstall('npm install lodash && grep -g foo bar')).toBeNull()
  })

  it('returns a human-readable reason string', () => {
    expect(detectGlobalInstall('uv tool install ruff')).toMatch(/uv tool install/)
  })
})

// Catches ordinary-install detection hiding a managed-state mutation in either compound order.
describe('independent install and mise detection', () => {
  it.each([
    ['mise use -g fd', null, 'direct mise mutation (use cli_search / cli_install)'],
    [
      'npm i -g x && mise use -g fd',
      'global JS package install (-g/--global)',
      'direct mise mutation (use cli_search / cli_install)'
    ],
    [
      'mise use -g fd && npm i -g x',
      'global JS package install (-g/--global)',
      'direct mise mutation (use cli_search / cli_install)'
    ],
    ['apt install x', 'system package-manager install', null],
    ['cargo install x', 'cargo install (persistent user tool)', null],
    ['pipx install x', 'pipx install (global)', null]
  ])('classifies %s', (command, globalInstall, miseMutation) => {
    expect(detectGlobalInstall(command)).toBe(globalInstall)
    expect(detectMiseMutation(command)).toBe(miseMutation)
  })

  it.each([
    ...['use', 'install', 'uninstall', 'remove', 'rm', 'prune', 'upgrade', 'update', 'reshim', 'trust', 'untrust'].map(
      (verb) => `mise ${verb} fd`
    ),
    ...['plugin', 'plugins'].flatMap((noun) =>
      ['install', 'uninstall', 'update'].map((verb) => `mise ${noun} ${verb} custom`)
    ),
    ...['setting', 'settings'].flatMap((noun) => ['set', 'unset'].map((verb) => `mise ${noun} ${verb} key`)),
    'mise use -g github:owner/tool',
    'mise plugins install custom https://example.com/plugin'
  ])('detects managed-state mutation: %s', (command) => {
    expect(detectGlobalInstall(command)).toBeNull()
    expect(detectMiseMutation(command)).toBe('direct mise mutation (use cli_search / cli_install)')
  })

  it.each(['&&', '||', ';', '\n', '|'])('isolates segments across %s', (separator) => {
    expect(detectGlobalInstall(`npm install lodash ${separator} grep -g foo bar`)).toBeNull()
    expect(detectMiseMutation(`mise ls ${separator} install fd`)).toBeNull()
    expect(detectMiseMutation(`mise plugins ${separator} install custom`)).toBeNull()
    expect(detectMiseMutation(`mise settings ${separator} set key`)).toBeNull()
    expect(detectMiseMutation(`npm i -g x ${separator} mise use -g fd`)).toBe(
      'direct mise mutation (use cli_search / cli_install)'
    )
  })

  it('preserves first-match-in-first-segment install evidence', () => {
    expect(detectGlobalInstall('cargo install x && npm i -g x')).toBe('cargo install (persistent user tool)')
    expect(detectGlobalInstall('npm i -g x && cargo install x')).toBe('global JS package install (-g/--global)')
  })
})
