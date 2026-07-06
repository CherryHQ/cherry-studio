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

  it('returns a human-readable reason string', () => {
    expect(detectGlobalInstall('uv tool install ruff')).toMatch(/uv tool install/)
  })
})
