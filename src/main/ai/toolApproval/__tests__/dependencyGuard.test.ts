import { describe, expect, it } from 'vitest'

import { detectGlobalInstall } from '../dependencyGuard'

describe('detectGlobalInstall — blocks global/shared installs', () => {
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
    'mise install fd',
    'mise use -g github:owner/tool',
    'mise uninstall fd',
    'mise plugins install custom https://example.com/plugin',
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
  })
})

describe('detectGlobalInstall — segment isolation', () => {
  it('does not flag when manager and flag are in different chained segments', () => {
    // `-g` here belongs to grep, not to npm install.
    expect(detectGlobalInstall('npm install lodash && grep -g foo bar')).toBeNull()
  })

  it('does not hard-block a literal default value in a quoted parameter expansion', () => {
    expect(detectGlobalInstall('printf "%s\\n" "${npm_command:-npm install -g;}"')).toBeNull()
  })

  it('returns a human-readable reason string', () => {
    expect(detectGlobalInstall('uv tool install ruff')).toMatch(/uv tool install/)
  })
})

describe('PowerShell shared installers', () => {
  it.each([
    'Install-Module Pester',
    'Install-Script foo',
    'winget install foo',
    'choco install foo',
    'scoop install foo'
  ])('flags %s', (command) => {
    expect(detectGlobalInstall(command, 'powershell')).not.toBeNull()
  })

  it.each(['echo Install-Module Pester', 'echo "Install-Module x"', 'winget list', 'echo "scoop install foo"'])(
    'allows %s',
    (command) => {
      expect(detectGlobalInstall(command, 'powershell')).toBeNull()
    }
  )
})

it.each([
  '& uv.exe tool install ruff',
  '& pip.exe install --user x',
  String.raw`& 'C:\Program Files\Python313\Scripts\pip.exe' install --user ruff`,
  String.raw`& "C:\Program Files\Python313\Scripts\pip.exe" install --user ruff`,
  'winget.exe install x',
  'choco.exe install x',
  'scoop.exe install x',
  'uv.exe tool install foo',
  'pip.exe install --user foo'
])('blocks executable shared install %s', (command) => {
  expect(detectGlobalInstall(command, 'powershell')).not.toBeNull()
})

it('keeps quoted ampersands within a PowerShell install argument', () => {
  expect(detectGlobalInstall('& pip.exe install "C:\\work\\pkg&tools" --user', 'powershell')).not.toBeNull()
})

it.each([
  "cat <<EOF\nit's fine\nEOF",
  'sed -n /}/p src/app.ts',
  'echo "oops',
  'echo $(foo',
  'echo ${foo',
  'echo `foo',
  'echo $(foo}',
  'echo ${foo)',
  'echo }'
])('does not hard-block unrelated or ambiguous shell input: %s', (command) => {
  expect(detectGlobalInstall(command, 'bash')).toBeNull()
})

it.each(['bash', 'powershell'] as const)('keeps healthy %s input allowed by the install guard', (shell) => {
  for (const command of ['echo )', 'echo $(foo)', 'echo "safe; rm -rf x"']) {
    expect(detectGlobalInstall(command, shell)).toBeNull()
  }
  expect(detectGlobalInstall('echo "oops', shell)).toBeNull()
})

it('keeps ambiguity out of the PowerShell global-install hard-block gate', () => {
  expect(detectGlobalInstall("@'\nit's fine\n'@", 'powershell')).toBeNull()
})

it('still blocks conventional shared installs', () => {
  expect(detectGlobalInstall('& pip.exe install --user x', 'powershell')).toBe(
    'global pip install (--user/--system/--break-system-packages)'
  )
  expect(detectGlobalInstall('npm i -g x', 'bash')).toBe('global JS package install (-g/--global)')
})
