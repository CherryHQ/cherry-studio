import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { createPlan, selectedGroups } from '../validation/plan.mjs'

const workflow = parse(readFileSync('.github/workflows/ci.yml', 'utf8'))
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
    const run = (event: string, before = base) => {
      const output = join(cwd, '.git', 'validation-output')
      writeFileSync(output, '')
      execFileSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
        cwd,
        env: { ...process.env, VALIDATION_PLAN: '', EVENT_NAME: event, BEFORE_SHA: before, GITHUB_OUTPUT: output }
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
  })

  it('fails required gates on missing classification and failed or skipped dependencies', () => {
    const plan = createPlan(['package.json'])
    const expected = selectedGroups(plan)
    for (const name of ['basic-checks', 'general-test', 'render-test']) {
      const job = workflow.jobs[name]
      const gate = job.steps
        .find((step: { run?: string }) => step.run?.includes('verify.mjs'))
        .run.split(' ')
        .at(-1)
      const jobs = Object.fromEntries(job.needs.map((dependency: string) => [dependency, { result: 'success' }]))
      jobs.changes = { result: 'success', outputs: { plan: JSON.stringify(plan) } }
      if (jobs['validation-checks']) jobs['validation-checks'].outputs = { repository: 'success', types: 'success' }
      const run = () =>
        spawnSync(process.execPath, ['scripts/validation/verify.mjs', gate], {
          env: { ...process.env, VALIDATION_JOBS: JSON.stringify(jobs) }
        }).status
      expect(run()).toBe(0)
      for (const dependency of job.needs) {
        for (const result of ['failure', 'cancelled', 'skipped']) {
          jobs[dependency].result = result
          expect(run()).not.toBe(0)
        }
        jobs[dependency].result = 'success'
        const saved = jobs[dependency]
        delete jobs[dependency]
        expect(run()).not.toBe(0)
        jobs[dependency] = saved
      }
      if (jobs['validation-checks']) {
        for (const group of ['repository', 'types']) {
          for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
            jobs['validation-checks'].outputs[group] = result
            expect(run()).not.toBe(0)
          }
          jobs['validation-checks'].outputs[group] = 'success'
        }
      }
      jobs.changes.outputs.plan = JSON.stringify(createPlan(['README.md']))
      for (const dependency of job.needs.filter((value: string) => value !== 'changes')) {
        if (dependency === 'validation-checks') {
          jobs[dependency].result = 'success'
          jobs[dependency].outputs = { repository: 'success', types: 'skipped' }
          continue
        }
        const condition = workflow.jobs[dependency].if
        const group = /outputs\.(\w+)/.exec(condition)?.[1]
        expect(group && Object.hasOwn(expected, group)).toBe(true)
        jobs[dependency].result = group === 'repository' ? 'success' : 'skipped'
      }
      expect(run()).toBe(0)
    }
  })
})

// Catch lost plan conditions and success markers that hide skipped work after sharing a runner.
describe('shared repository and type preparation', () => {
  const job = workflow.jobs['validation-checks']
  const simulate = (repository: boolean, types: boolean, overrides: Record<string, string> = {}) => {
    const plan = {
      tasks: [...(repository ? ['format', 'knowledge', 'migrations'] : []), ...(types ? ['types-node'] : [])],
      projects: []
    }
    const needs = {
      changes: { outputs: { repository: String(repository), types: String(types), plan: JSON.stringify(plan) } }
    }
    const steps: Record<string, { outcome: string; outputs: Record<string, string> }> = {}
    const executed: string[] = []
    let success = true
    let cancelled = false
    for (const step of job.steps) {
      const condition = step.if ?? 'success()'
      const explicitStatus = /(?:success|failure|cancelled|always)\(/.test(condition)
      const expression = condition.replace(/steps\.([\w-]+)/g, 'steps["$1"]')
      const selected =
        (explicitStatus || success) &&
        new Function(
          'needs',
          'steps',
          'github',
          'success',
          'cancelled',
          'contains',
          'fromJSON',
          `return (${expression})`
        )(
          needs,
          steps,
          {
            event_name: 'pull_request',
            head_ref: 'feature',
            repository: 'CherryHQ/cherry-studio',
            event: { pull_request: { head: { repo: { full_name: 'CherryHQ/cherry-studio' } } } }
          },
          () => success,
          () => cancelled,
          (values: string[], value: string) => values.includes(value),
          JSON.parse
        )
      const outcome = selected ? (overrides[step.name ?? step.id] ?? 'success') : 'skipped'
      if (selected && outcome !== 'skipped') executed.push(step.run ?? step.uses)
      if (step.id) steps[step.id] = { outcome, outputs: { data: 'false', source: 'false' } }
      if (outcome === 'failure') success = false
      if (outcome === 'cancelled') {
        success = false
        cancelled = true
      }
    }
    const outputs = Object.fromEntries(
      Object.entries(job.outputs).map(([group, expression]) => {
        const id = /steps\.([\w-]+)\.outcome/.exec(expression as string)![1]
        return [group, steps[id]?.outcome]
      })
    )
    const jobs = {
      changes: { result: 'success', outputs: { plan: JSON.stringify(plan) } },
      'validation-checks': { result: cancelled ? 'cancelled' : success ? 'success' : 'failure', outputs },
      'lint-checks': { result: 'skipped' },
      'i18n-checks': { result: 'skipped' }
    }
    const gate = spawnSync(process.execPath, ['scripts/validation/verify.mjs', 'basic'], {
      env: { ...process.env, VALIDATION_JOBS: JSON.stringify(jobs) }
    }).status
    return { executed, outputs, gate }
  }

  it.each([
    [true, true],
    [true, false],
    [false, true],
    [false, false]
  ])('preserves independently selected groups: repository=%s types=%s', (repository, types) => {
    const { executed, outputs, gate } = simulate(repository, types)
    expect(executed.includes('pnpm check --group repository')).toBe(repository)
    expect(executed.includes('pnpm check --group types')).toBe(types)
    expect(executed.filter((command) => command === './.github/actions/setup-validation')).toHaveLength(1)
    expect(outputs.repository).toBe(repository ? 'success' : 'skipped')
    expect(outputs.types).toBe(types ? 'success' : 'skipped')
    expect(gate).toBe(0)
    // The runner itself must be omitted if neither group was selected.
    expect(
      new Function('needs', `return (${job.if})`)({
        changes: {
          outputs: {
            repository: String(repository),
            types: String(types)
          }
        }
      })
    ).toBe(repository || types)
  })

  it.each([
    'Lint GitHub Actions workflows',
    'Check provider-registry compatibility baseline policy',
    'Check changesets',
    'Repository checks',
    'DB Migrations Check',
    'System Provider IDs Check'
  ])('keeps the gate closed after %s fails and still runs selected type checks', (name) => {
    const result = simulate(true, true, { [name]: 'failure' })
    expect(result.executed).toContain('pnpm check --group types')
    expect(result.outputs.repository).toBe('skipped')
    expect(result.gate).not.toBe(0)
  })

  it.each(['failure', 'cancelled', 'skipped'])('rejects %s dependency preparation', (outcome) => {
    const result = simulate(true, true, { dependencies: outcome })
    expect(result.executed).not.toContain('pnpm check --group types')
    expect(result.gate).not.toBe(0)
  })

  it.each(['failure', 'cancelled', 'skipped'])('rejects %s type checks', (outcome) => {
    expect(simulate(true, true, { 'Type checks': outcome }).gate).not.toBe(0)
  })

  it('rejects skipped repository checks even if the job would otherwise succeed', () => {
    expect(simulate(true, true, { 'Repository checks': 'skipped' }).gate).not.toBe(0)
  })

  it('rejects a successful job whose required repository success marker was skipped', () => {
    expect(simulate(true, false, { 'Record repository success': 'skipped' }).gate).not.toBe(0)
  })
})
