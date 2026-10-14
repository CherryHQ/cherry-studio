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
        jobs.changes.outputs.plan = JSON.stringify({ tasks: ['types-node'], projects: [] })
        jobs['validation-checks'].outputs.repository = 'skipped'
        for (const dependency of ['lint-checks', 'i18n-checks']) jobs[dependency].result = 'skipped'
        expect(run()).toBe(0)
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

describe('shared validation configuration', () => {
  it('shares one install and exports separate repository/type outcomes', () => {
    const job = workflow.jobs['validation-checks']
    expect(
      job.steps.filter((step: { uses?: string }) => step.uses === './.github/actions/setup-validation')
    ).toHaveLength(1)
    expect(job.steps.find((step: { id?: string }) => step.id === 'repository-result').if).toContain(
      "steps.repository-checks.outcome == 'success'"
    )
    expect(job.outputs).toEqual({
      repository: '${{ steps.repository-result.outcome }}',
      types: '${{ steps.type-checks.outcome }}'
    })
    expect(job.steps.find((step: { id?: string }) => step.id === 'repository-checks').run).toBe(
      'pnpm check --group repository'
    )
    expect(job.steps.find((step: { id?: string }) => step.id === 'type-checks').run).toBe('pnpm check --group types')
  })

  it.each([
    [true, true],
    [true, false],
    [false, true],
    [false, false]
  ])('keeps separate plan conditions: repository=%s types=%s', (repository, types) => {
    const job = workflow.jobs['validation-checks']
    const needs = { changes: { outputs: { repository: String(repository), types: String(types) } } }
    expect(new Function('needs', `return (${job.if})`)(needs)).toBe(repository || types)
    const repositoryStep = job.steps.find((step: { id?: string }) => step.id === 'repository-checks')
    expect(new Function('needs', `return (${repositoryStep.if})`)(needs)).toBe(repository)
    const typeStep = job.steps.find((step: { id?: string }) => step.id === 'type-checks')
    expect(typeStep.if).toContain('!cancelled()')
    const runTypes = (outcome: string, cancelled: boolean) =>
      new Function('needs', 'steps', 'cancelled', 'success', `return (${typeStep.if})`)(
        needs,
        { dependencies: { outcome } },
        () => cancelled,
        () => false
      )
    expect(runTypes('success', false)).toBe(types)
    expect(runTypes('failure', false)).toBe(false)
    expect(runTypes('success', true)).toBe(false)
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

describe('PR description workflow configuration', () => {
  const description = parse(readFileSync('.github/workflows/pr-description-check.yml', 'utf8'))

  it('uses one job and cancels superseded runs for the same PR', () => {
    expect(Object.keys(description.jobs)).toEqual(['check-description'])
    expect(description.concurrency.group).toContain('github.event.pull_request.number')
    expect(description.concurrency['cancel-in-progress']).toBe(true)
    expect(description.jobs['check-description'].if).toBe('github.event.pull_request.draft == false')
  })

  it('reminds on synchronize after validation failure, but not on other events or cancellation', () => {
    const reminder = description.jobs['check-description'].steps.find(
      (step: { name?: string }) => step.name === 'Remind to review description'
    )
    // A status function overrides GitHub's implicit success() after an earlier step failed.
    expect(reminder.if).toMatch(/(?:always|cancelled|failure)\(/)
    const selected = (action: string, cancelled: boolean) =>
      new Function('github', 'always', 'cancelled', 'success', `return (${reminder.if})`)(
        { event: { action } },
        () => true,
        () => cancelled,
        () => false
      )
    expect(selected('synchronize', false)).toBe(true)
    for (const action of ['opened', 'edited', 'ready_for_review']) expect(selected(action, false)).toBe(false)
    expect(selected('synchronize', true)).toBe(false)
  })
})
