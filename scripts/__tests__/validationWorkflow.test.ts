import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { createPlan, selectedGroups } from '../validation/plan.mjs'

const workflow = parse(readFileSync('.github/workflows/ci.yml', 'utf8'))
const verify = (gate: string, jobs: unknown) =>
  spawnSync(process.execPath, ['scripts/validation/verify.mjs', gate], {
    env: { ...process.env, VALIDATION_JOBS: JSON.stringify(jobs) }
  }).status
const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('CI validation planning', () => {
  it('uses the whole PR and push range even when the last commit only changes docs', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'cherry-ci-plan-'))
    directories.push(cwd)
    const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
    const commit = (message: string) => {
      git('add', '.')
      git('-c', 'commit.gpgsign=false', 'commit', '-qm', message)
      return git('rev-parse', 'HEAD')
    }
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'Test')
    git('remote', 'add', 'origin', cwd)
    cpSync('scripts/validation', join(cwd, 'scripts/validation'), { recursive: true })
    const base = commit('base')
    git('checkout', '-qb', 'feature')
    mkdirSync(join(cwd, 'src/renderer'), { recursive: true })
    writeFileSync(join(cwd, 'src/renderer/app.ts'), 'export const value = 1')
    commit('renderer change')
    writeFileSync(join(cwd, 'README.md'), 'docs')
    commit('docs')
    git('checkout', 'main')
    git('-c', 'commit.gpgsign=false', 'merge', '--no-ff', 'feature', '-m', 'merge')
    const script = workflow.jobs.changes.steps.find((step: { id?: string }) => step.id === 'plan').run
    const run = (event: string, before = base, ref = 'refs/heads/release/v2.1.10') => {
      const output = join(cwd, '.git', 'validation-output')
      writeFileSync(output, '')
      execFileSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
        cwd,
        env: {
          ...process.env,
          VALIDATION_PLAN: '',
          EVENT_NAME: event,
          BEFORE_SHA: before,
          REF: ref,
          GITHUB_OUTPUT: output
        }
      })
      return JSON.parse(
        readFileSync(output, 'utf8')
          .split('\n')
          .find((line) => line.startsWith('plan='))!
          .slice(5)
      )
    }
    for (const event of ['pull_request', 'push']) {
      const plan = run(event)
      expect(plan.projects).toContain('renderer')
      expect(plan.projects).not.toContain('main')
    }
    for (const event of ['schedule', 'workflow_dispatch']) expect(run(event).projects).toContain('main')
    expect(run('push', '0000000000000000000000000000000000000000').projects).toContain('main')
    git('checkout', '-qb', 'docs-only', base)
    writeFileSync(join(cwd, 'README.md'), 'docs only')
    commit('docs only')
    expect(run('push').projects).toEqual([])
    expect(run('push', base, 'refs/heads/main').projects).toEqual(createPlan(['package.json']).projects)
  })

  it('fails test gates on missing classification and failed, cancelled, skipped or missing dependencies', () => {
    for (const [name, gate] of [
      ['basic-checks', 'basic'],
      ['general-test', 'general'],
      ['render-test', 'renderer']
    ]) {
      const job = workflow.jobs[name]
      const jobs = Object.fromEntries(job.needs.map((dependency: string) => [dependency, { result: 'success' }]))
      jobs.changes = { result: 'success', outputs: { plan: JSON.stringify(createPlan(['package.json'])) } }
      expect(verify(gate, jobs)).toBe(0)
      for (const dependency of job.needs) {
        for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
          jobs[dependency].result = result
          expect(verify(gate, jobs)).not.toBe(0)
        }
        jobs[dependency].result = 'success'
      }
      jobs.changes.outputs.plan = JSON.stringify(createPlan(['README.md']))
      for (const dependency of job.needs.filter((id: string) => !['changes', 'repository-checks'].includes(id)))
        jobs[dependency].result = 'skipped'
      expect(verify(gate, jobs)).toBe(0)
    }
  })
})

describe('independent validation scheduling', () => {
  it('selects every heavy group for code and only repository checks for documentation', () => {
    for (const [file, expected] of [
      ['package.json', ['repository-checks', 'type-checks', 'lint-checks', 'i18n-checks']],
      ['README.md', ['repository-checks']]
    ] as const) {
      const outputs = selectedGroups(createPlan([file]))
      const selected = ['repository-checks', 'type-checks', 'lint-checks', 'i18n-checks'].filter((name) => {
        const job = workflow.jobs[name]
        expect(job.needs).toBe('changes')
        return new Function('needs', `return (${job.if})`)({
          changes: { outputs: Object.fromEntries(Object.entries(outputs).map(([key, value]) => [key, String(value)])) }
        })
      })
      expect(selected).toEqual(expected)
    }
  })

  it('cancels only runs for the same PR and gives each main push its own group', () => {
    const expression = (value: string, github: unknown) =>
      new Function('github', `return (${value.replace(/^\$\{\{\s*|\s*\}\}$/g, '')})`)(github)
    const context = (run: number, number?: number) => ({
      workflow: 'CI',
      run_id: run,
      ref: 'refs/heads/main',
      event_name: number ? 'pull_request' : 'push',
      event: { pull_request: number ? { number } : undefined }
    })
    const group = workflow.concurrency.group.replaceAll('${{ github.workflow }}-', '')
    // Undefined PR data is null in Actions expressions.
    const main = (run: number) => ({ ...context(run), event: { pull_request: {} } })
    expect(expression(group, context(1, 7))).toBe(expression(group, context(2, 7)))
    expect(expression(group, context(1, 7))).not.toBe(expression(group, context(2, 8)))
    expect(expression(group, main(1))).not.toBe(expression(group, main(2)))
    expect(expression(workflow.concurrency['cancel-in-progress'], context(1, 7))).toBe(true)
    expect(expression(workflow.concurrency['cancel-in-progress'], main(1))).toBe(false)
  })

  it('requires successful installation and native/declaration preparation before prepared validation', () => {
    for (const [name, prerequisite] of [
      ['main-test-shard', 'pnpm rebuild:node'],
      ['platform-test', 'pnpm rebuild:node'],
      ['type-checks', 'pnpm --filter @cherrystudio/ai-sdk-provider build'],
      ['renderer-test-shard', undefined],
      ['package-test', undefined]
    ]) {
      const steps = workflow.jobs[name!].steps
      const install = steps.findIndex((step: { uses?: string }) => step.uses === './.github/actions/setup-validation')
      const validate = steps.findIndex((step: { run?: string }) => step.run?.includes('--prepared'))
      expect(install).toBeGreaterThanOrEqual(0)
      expect(validate).toBeGreaterThan(install)
      if (prerequisite) {
        const prepare = steps.findIndex((step: { run?: string }) => step.run === prerequisite)
        expect(prepare).toBeGreaterThan(install)
        expect(validate).toBeGreaterThan(prepare)
      }
      for (const step of steps.slice(install, validate + 1)) {
        expect(step['continue-on-error']).toBeUndefined()
        expect(step.if).toBeUndefined()
      }
    }
  })

  it('seeds platform caches on main without letting PRs write the shared cache', () => {
    for (const name of ['repository-checks', 'platform-test']) {
      const setup = workflow.jobs[name].steps.find(
        (step: { uses?: string }) => step.uses === './.github/actions/setup-validation'
      )
      const evaluate = (event: string, ref: string) =>
        new Function('github', `return (${setup.with['save-cache'].replace(/^\$\{\{\s*|\s*\}\}$/g, '')})`)({
          event_name: event,
          ref
        })
      expect(evaluate('push', 'refs/heads/main')).toBe(true)
      expect(evaluate('schedule', 'refs/heads/main')).toBe(true)
      expect(evaluate('pull_request', 'refs/heads/main')).toBe(false)
      expect(evaluate('push', 'refs/heads/release/v2.1.10')).toBe(false)
    }
  })
})

// A failed dependency must still reach its gate; a cancelled workflow must not allocate another runner.
describe('required gate scheduling', () => {
  it.each([
    ['successful dependencies', 'success', 'pull_request', false, false, true],
    ['failed dependencies', 'failure', 'pull_request', false, false, true],
    ['skipped dependencies', 'skipped', 'pull_request', false, false, true],
    ['workflow cancellation', 'success', 'pull_request', false, true, false],
    ['draft pull request', 'success', 'pull_request', true, false, false],
    ['manual validation', 'success', 'workflow_dispatch', false, false, true]
  ])('handles %s with the upstream cancellation condition', (_name, dependency, event, draft, cancelled, expected) => {
    for (const name of ['basic-checks', 'general-test', 'render-test']) {
      const condition = workflow.jobs[name].if.replace(/^\$\{\{\s*|\s*\}\}$/g, '')
      expect(condition).toContain('!cancelled()')
      const selected = new Function('github', 'cancelled', 'success', `return (${condition})`)(
        { event_name: event, event: { pull_request: { draft } } },
        () => cancelled,
        () => dependency === 'success'
      )
      expect(selected).toBe(expected)
    }
  })
})
