import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { changedFiles, createPlan, selectedGroups, verifyResults } from '../validation/plan.mjs'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('validation selection', () => {
  it.each([
    'docs/contrib/development.md',
    'src/main/core/README.md',
    'packages/ui/README.md',
    '.agents/notes/proposed/process/plan.zh.md'
  ])('keeps ordinary documentation out of code tests: %s', (file) => {
    const plan = createPlan([file])
    expect(plan.tasks).toEqual(['format', 'docs'])
    expect(plan.projects).toEqual([])
  })
  it('preserves resource contracts for runtime Markdown and mixed changes', () => {
    const runtime = createPlan(['resources/skills/tool/SKILL.md'])
    expect(runtime.projects).toContain('scripts')
    expect(runtime.projects).toContain('main')
    const mixed = createPlan(['docs/README.md', 'src/renderer/components/Thing.tsx'])
    expect(mixed.projects).toContain('renderer')
    expect(mixed.tasks).toContain('types-web')
    expect(mixed.projects).not.toContain('main')
  })
  it.each([
    ['packages/ai-sdk-provider/src/model.ts', ['ai-sdk-provider', 'aiCore', 'main', 'renderer']],
    ['packages/dsh-bridge/src/link.ts', ['dsh-bridge', 'main']],
    ['packages/remote-protocol/src/agent.ts', ['remote-protocol', 'remote-transport', 'main', 'renderer']],
    ['packages/remote-transport/src/socket.ts', ['remote-transport', 'main', 'renderer']],
    ['packages/ui/src/button.tsx', ['ui', 'renderer']],
    ['packages/file-preview/src/Preview.tsx', ['file-preview', 'renderer']],
    ['packages/provider-registry/src/index.ts', ['provider-registry', 'shared', 'main', 'renderer']],
    ['src/preload/types.d.ts', ['preload', 'main', 'renderer']],
    ['src/shared/types/agent.ts', ['main', 'renderer', 'scripts']]
  ])('includes own and consumer tests for %s', (file, projects) => {
    expect(createPlan([file]).projects).toEqual(expect.arrayContaining(projects))
  })
  it.each([
    'pnpm-lock.yaml',
    '.node-version',
    'tests/new.setup.ts',
    'packages/new-package/src/index.ts',
    'scripts/validation/plan.mjs'
  ])('falls back to full validation for infrastructure or unclassified inputs: %s', (file) => {
    expect(createPlan([file]).projects).toContain('main')
    expect(createPlan([file]).projects).toContain('renderer')
    expect(createPlan([file]).tasks).toContain('types-e2e')
  })
  it.each([
    'backport-release-fixes',
    'auto-release-build',
    'post-release',
    'prepare-release',
    'preview-release',
    'publish-release',
    'release'
  ])('runs script contracts for release-workflow-only changes: %s', (name) => {
    expect(createPlan([`.github/workflows/${name}.yml`]).projects).toContain('scripts')
  })
  it('checks translation references after source changes and migration integrity after schema changes', () => {
    expect(createPlan(['src/renderer/pages/Chat.tsx']).tasks).toContain('i18n-unused')
    expect(createPlan(['src/main/data/db/schemas/messages.ts']).tasks).toContain('migrations')
    expect(createPlan(['migrations/sqlite-drizzle/0001.sql']).projects).toContain('main')
    expect(createPlan(['.agents/skills/example/SKILL.md']).tasks).toContain('skills')
  })
  it('rejects missing, failed, cancelled or unexpectedly skipped planned jobs', () => {
    const plan = createPlan(['src/main/service.ts'])
    const results = Object.fromEntries(
      Object.entries(selectedGroups(plan)).map(([key, required]) => [key, required ? 'success' : 'skipped'])
    )
    expect(() => verifyResults(plan, results)).not.toThrow()
    for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
      expect(() => verifyResults(plan, { ...results, main: result })).toThrow('main: expected success')
    }
    expect(() =>
      verifyResults(createPlan([]), Object.fromEntries(Object.keys(results).map((key) => [key, 'skipped'])))
    ).not.toThrow()
  })
})

describe('working tree changes', () => {
  it('includes the whole branch, both sides of renames, staged edits, unstaged edits and new files', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'cherry-validation-'))
    directories.push(cwd)
    const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
    const write = (file: string, text: string) => writeFileSync(join(cwd, file), text)
    git('init', '-q')
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'Test')
    write('old.ts', 'export const a = 1')
    write('edit.ts', 'export const a = 1')
    write('staged.ts', 'export const a = 1')
    git('add', '.')
    git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'base')
    const base = git('rev-parse', 'HEAD')
    git('mv', 'old.ts', 'new.ts')
    git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'rename')
    mkdirSync(join(cwd, 'docs'))
    write('docs/readme.md', 'docs')
    git('add', '.')
    git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'docs')
    write('staged.ts', 'export const a = 2')
    git('add', 'staged.ts')
    write('staged.ts', 'export const a = 1')
    write('edit.ts', 'export const a = 3')
    write('untracked.ts', 'new')
    expect(changedFiles(cwd, base).sort()).toEqual([
      'docs/readme.md',
      'edit.ts',
      'new.ts',
      'old.ts',
      'staged.ts',
      'untracked.ts'
    ])
    expect(changedFiles(cwd, base, 'HEAD', false).sort()).toEqual(['docs/readme.md', 'new.ts', 'old.ts'])
    expect(() => changedFiles(cwd, 'missing-base')).toThrow()
    git('add', '.')
    git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'local edits')
    const localHead = git('rev-parse', 'HEAD')
    git('checkout', '-qb', 'upstream', base)
    write('upstream-only.ts', 'unrelated change')
    git('add', '.')
    git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'upstream edits')
    expect(changedFiles(cwd, 'upstream', localHead, true)).not.toContain('upstream-only.ts')
  })
})

// A docs-only plan must never start compilers, native rebuilds, lint fixes, or tests.
describe('validation execution', () => {
  it('executes only planned read-only tasks and propagates command failures', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'cherry-validation-run-'))
    directories.push(cwd)
    const log = join(cwd, 'commands.jsonl')
    const pnpm = join(cwd, 'pnpm.cjs')
    writeFileSync(
      pnpm,
      `require('node:fs').appendFileSync(process.env.COMMAND_LOG, JSON.stringify(process.argv.slice(2)) + '\\n'); process.exit(Number(process.env.COMMAND_EXIT || 0))`
    )
    const env = {
      ...process.env,
      npm_execpath: pnpm,
      COMMAND_LOG: log,
      VALIDATION_PLAN: JSON.stringify(createPlan(['docs/contrib/development.md']))
    }
    const invoke = (...args: string[]) =>
      spawnSync(process.execPath, ['scripts/validation/run.mjs', ...args], { env, encoding: 'utf8' })
    expect(invoke().status).toBe(0)
    expect(
      readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    ).toEqual([['format:check'], ['docs:check']])
    const before = readFileSync(log, 'utf8')
    expect(invoke('--plan').status).toBe(0)
    expect(invoke('--group', 'lint').status).toBe(0)
    expect(readFileSync(log, 'utf8')).toBe(before)
    expect(invoke('--group', 'unknown').status).not.toBe(0)
    expect(
      spawnSync(process.execPath, ['scripts/validation/run.mjs'], { env: { ...env, COMMAND_EXIT: '7' } }).status
    ).toBe(7)
  })
})
