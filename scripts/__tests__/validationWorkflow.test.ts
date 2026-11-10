import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { createPlan } from '../validation/plan.mjs'

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
  it('covers the whole PR and fully validates every push, including docs-only pushes', () => {
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
    for (const event of ['pull_request']) {
      const plan = run(event)
      expect(plan.projects).toContain('renderer')
      expect(plan.projects).not.toContain('main')
    }
    for (const event of ['push', 'schedule', 'workflow_dispatch']) expect(run(event).projects).toContain('main')
    expect(run('push', '0000000000000000000000000000000000000000').projects).toContain('main')
    git('checkout', '-qb', 'docs-only', base)
    writeFileSync(join(cwd, 'README.md'), 'docs only')
    commit('docs only')
    expect(run('push').projects).toContain('main')
    expect(run('pull_request').projects).toEqual([])
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

// Bursts of main pushes must not replace pending runs; only superseded PRs may cancel.
describe('CI concurrency', () => {
  const evaluate = (template: string, github: unknown) =>
    template.replace(/\$\{\{(.*?)\}\}/g, (_match, expression) =>
      String(new Function('github', `return (${expression})`)(github))
    )
  it.each(['push', 'schedule', 'workflow_dispatch'])('keeps every %s run independent', (event) => {
    const context = {
      workflow: 'CI',
      event_name: event,
      event: { pull_request: {} },
      ref: 'refs/heads/main',
      run_id: 1
    }
    expect(evaluate(workflow.concurrency.group, context)).not.toBe(
      evaluate(workflow.concurrency.group, { ...context, run_id: 2 })
    )
    expect(evaluate(workflow.concurrency['cancel-in-progress'], context)).toBe('false')
  })
  it('groups successive runs of one PR and cancels its older run', () => {
    const context = { workflow: 'CI', event_name: 'pull_request', event: { pull_request: { number: 123 } }, run_id: 1 }
    expect(evaluate(workflow.concurrency.group, context)).toBe(
      evaluate(workflow.concurrency.group, { ...context, run_id: 2 })
    )
    expect(evaluate(workflow.concurrency['cancel-in-progress'], context)).toBe('true')
  })
})
