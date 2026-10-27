import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'

import type { JSONReport, JSONReportSuite } from '@playwright/test/reporter'
import { parse } from 'yaml'

import { getCase, missingCapabilities, PHASE_IDS, selectCases, supportsPlatform, TASK_SELECTIONS } from '../cases'

describe('regression execution plan', () => {
  it('offers every supported task in the workflow dropdown with full regression as the default', () => {
    const workflow = parse(readFileSync(resolve('.github/workflows/e2e-regression-test.yml'), 'utf8'))
    const task = workflow.on.workflow_dispatch.inputs.task
    expect(task.type).toBe('choice')
    expect(task.default).toBe('all')
    expect(task.options).toEqual(TASK_SELECTIONS)
  })

  it('caches only tool downloads and still installs and checks every tool on a cache hit', () => {
    const workflow = parse(readFileSync(resolve('.github/workflows/e2e-regression-test.yml'), 'utf8'))
    const steps = workflow.jobs.test.steps
    const cacheIndex = steps.findIndex((step: { name: string }) => step.name === 'Cache code tool downloads')
    const installIndex = steps.findIndex((step: { name: string }) => step.name === 'Install code tools under test')
    const cache = steps[cacheIndex]
    const install = steps[installIndex]
    expect(cacheIndex).toBeGreaterThan(-1)
    expect(cacheIndex).toBeLessThan(installIndex)
    expect(cache.with.path).toBe(`${install.env.npm_config_cache}/_cacache`)
    expect(install.env.npm_config_cache).toBe('${{ runner.temp }}/cherry-code-tools-npm')
    for (const dimension of ['runner.os', 'runner.arch', 'env.NODE_VERSION']) {
      expect(cache.with.key).toContain(`\${{ ${dimension} }}`)
    }
    expect(cache.with.key).toContain("hashFiles('.github/workflows/e2e-regression-test.yml')")
    expect(install.if).toBeUndefined()
    expect(install.run).toMatch(/^npm install --global /)
    for (const tool of ['@anthropic-ai/claude-code', '@openai/codex', 'openclaw']) {
      expect(install.run).toMatch(new RegExp(`${tool}@\\d+\\.\\d+\\.\\d+(?:\\s|$)`))
    }
    for (const command of ['claude --version', 'codex --version', 'openclaw --version']) {
      expect(install.run.split('\n')).toContain(command)
    }
  })

  it.each([
    { event_name: 'workflow_dispatch', ref_type: 'branch', ref: 'refs/heads/main', allowed: true },
    { event_name: 'workflow_dispatch', ref_type: 'branch', ref: 'refs/heads/feature/e2e-fix', allowed: true },
    { event_name: 'workflow_dispatch', ref_type: 'tag', ref: 'refs/tags/v2.0.8', allowed: false },
    { event_name: 'pull_request', ref_type: 'branch', ref: 'refs/pull/123/merge', allowed: false }
  ])('gates controller execution for $event_name on $ref', ({ allowed, ...github }) => {
    const workflow = parse(readFileSync(resolve('.github/workflows/e2e-regression-test.yml'), 'utf8'))
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch'])
    expect(runInNewContext(workflow.jobs.resolve.if, { github })).toBe(allowed)
    expect(workflow.concurrency['cancel-in-progress']).toBe(false)
  })

  it('prepares native and utility-process dependencies before the first branch launch only', () => {
    const workflow = parse(readFileSync(resolve('.github/workflows/e2e-regression-test.yml'), 'utf8'))
    const steps = workflow.jobs.test.steps as Array<{ name: string; if?: string; run?: string }>
    const prepare = steps.findIndex((step) => step.name === 'Prepare application runtime once')
    expect(prepare).toBeGreaterThan(steps.findIndex((step) => step.name === 'Install application dependencies'))
    expect(prepare).toBeLessThan(steps.findIndex((step) => step.name === 'Launch controlled Cherry Studio once'))
    expect(steps[prepare].if).toBe("needs.resolve.outputs.mode == 'branch'")
    const commands = steps.flatMap((step) => step.run?.split('\n') ?? [])
    expect(commands.filter((command) => command.includes('rebuild:electron'))).toEqual([
      'pnpm --dir target-app rebuild:electron'
    ])
    expect(commands.filter((command) => command.includes('build:utility-process'))).toEqual([
      'pnpm --dir target-app run build:utility-process'
    ])
  })

  it('selects only the requested task within its workflow phase', () => {
    expect(selectCases('translation-settings', 'translation').map(({ id }) => id)).toEqual(['MP-86'])
    expect(selectCases('knowledge-smoke', 'knowledge').map(({ id }) => id)).toEqual(['K-01'])
    expect(selectCases('code-cli', 'codeTools').map(({ id }) => id)).toEqual(['CODE-01', 'CODE-02'])
    expect(selectCases('notes', 'modelsAndAssistants')).toEqual([])
    expect(selectCases('notes', 'basicFeatures').map(({ id }) => id)).toEqual(['N-01'])
    expect(() => getCase('missing')).toThrow('Unknown regression case')
  })

  it.each([
    ['notes', ['N-01', 'MP-11', 'MP-74', 'MP-75', 'MP-76', 'MP-77', 'MP-78', 'MP-79']],
    ['knowledge', ['K-01', 'MP-59', 'MP-60', 'MP-61', 'MP-62', 'MP-63', 'MP-64', 'MP-65', 'MP-66', 'MP-67']],
    ['code-tools', ['CODE-01', 'CODE-02', 'CODE-03', 'MP-97']],
    ['paintings', ['P-01', 'MP-90', 'MP-91', 'MP-92']],
    ['translation', ['T-01', 'T-02', 'MP-81', 'MP-82', 'MP-83', 'MP-85', 'MP-86']]
  ] as const)('includes existing scenarios as well as case-library scenarios in %s', (task, ids) => {
    expect(selectCases(task).map(({ id }) => id)).toEqual(ids)
  })

  it.each([
    ['notes-smoke', ['N-01']],
    ['knowledge-smoke', ['K-01']],
    ['mini-app-pinning', ['MP-103']],
    ['chat-error-recovery', ['MP-17']],
    ['code-cli-permissions', ['MP-97']]
  ] as const)('keeps the focused task %s limited to its intended scenarios', (task, ids) => {
    expect(selectCases(task).map(({ id }) => id)).toEqual(ids)
  })

  it('keeps execution order out of selectable task names', () => {
    for (const task of TASK_SELECTIONS) expect(task).not.toMatch(/^\d/)
  })

  it('prepares the MCP server package for both the module and focused MCP tasks', () => {
    const workflow = parse(readFileSync(resolve('.github/workflows/e2e-regression-test.yml'), 'utf8'))
    const step = workflow.jobs.test.steps.find(
      (step: { name: string }) => step.name === 'Prepare Everything MCP package'
    )
    for (const task of ['all', 'mcp-skills', 'everything-mcp', 'notes']) {
      expect(runInNewContext(step.if, { needs: { resolve: { outputs: { task } } } })).toBe(task !== 'notes')
    }
  })

  it('keeps each manifest phase executable by the workflow', () => {
    const workflow = parse(readFileSync(resolve('.github/workflows/e2e-regression-test.yml'), 'utf8'))
    const phases = workflow.jobs.test.steps
      .filter((step: { run?: string }) => step.run?.includes('cli.ts run-phase'))
      .map((step: { run: string }) => /--phase ([\w-]+)/.exec(step.run)?.[1])
    expect(phases).toEqual(PHASE_IDS)
    expect(readdirSync(resolve('tests/e2e/regression/phases')).sort()).toEqual(
      PHASE_IDS.map((phase) => `${phase}.test.ts`).sort()
    )
    for (const phase of PHASE_IDS) expect(phase).toMatch(/^[a-z][a-zA-Z0-9]*$/)
  })

  it('blocks native interactions when desktop automation is missing without blocking pure UI tasks', () => {
    expect(missingCapabilities('C-02', { desktopAutomation: { available: false } })).toEqual(['desktopAutomation'])
    expect(missingCapabilities('C-02', {})).toEqual(['desktopAutomation'])
    expect(missingCapabilities('C-02', { desktopAutomation: { available: true } })).toEqual([])
    expect(missingCapabilities('N-01', {})).toEqual([])
  })

  it('keeps macOS-only scenarios out of Windows runs and leaves cross-platform cases applicable', () => {
    for (const id of [
      'MP-52',
      'MP-56',
      'MP-68',
      'MP-70',
      'MP-72',
      'MP-77',
      'MP-82',
      'MP-90',
      'MP-97',
      'MP-105',
      'MP-110',
      'MP-111',
      'MP-121',
      'MP-127',
      'MP-132',
      'MP-133',
      'MP-140'
    ] as const) {
      expect(supportsPlatform(id, 'macos')).toBe(true)
    }
    for (const id of [
      'MP-52',
      'MP-56',
      'MP-68',
      'MP-72',
      'MP-77',
      'MP-82',
      'MP-90',
      'MP-97',
      'MP-105',
      'MP-110',
      'MP-111',
      'MP-121',
      'MP-127',
      'MP-132',
      'MP-133',
      'MP-140'
    ] as const) {
      expect(supportsPlatform(id, 'windows'), id).toBe(false)
    }
    for (const id of ['MP-70', 'MP-109', 'S-01'] as const) {
      expect(supportsPlatform(id, 'windows'), id).toBe(true)
    }
  })
})

it.each(['all', 'notes', 'notes-smoke', 'knowledge', 'code-tools', 'code-cli-permissions'] as const)(
  'discovers the selected %s cases through Playwright without matching another task prefix',
  (task) => {
    const directory = mkdtempSync(join(tmpdir(), 'cherry-regression-enumeration-'))
    try {
      const cli = createRequire(import.meta.url).resolve('@playwright/test/cli')
      const args = [cli, 'test', '--config', 'playwright.regression.config.ts', '--list', '--reporter=json']
      if (task !== 'all') args.push('--grep', `@${task}(?:\\s|$)`)
      const report = JSON.parse(
        execFileSync(process.execPath, args, {
          encoding: 'utf8',
          timeout: 20_000,
          env: { ...process.env, CHERRY_TEST_RUN_DIR: directory }
        })
      ) as JSONReport
      const collect = (suites: JSONReportSuite[]): Array<{ id: string | undefined; tasks: string[]; phase: string }> =>
        suites.flatMap((suite) => [
          ...suite.specs.flatMap((spec) =>
            spec.tests.map((test) => ({
              id: test.annotations.find(({ type }) => type === 'regression-case')?.description,
              tasks: spec.tags,
              phase: basename(spec.file, '.test.ts')
            }))
          ),
          ...collect(suite.suites ?? [])
        ])
      expect(report.errors).toEqual([])
      const discovered = collect(report.suites)
      const selected = selectCases(task).map(({ id, tasks, phase }) => ({ id, tasks, phase }))
      expect(discovered).toHaveLength(selected.length)
      for (const phase of PHASE_IDS) {
        expect(discovered.filter((test) => test.phase === phase)).toEqual(
          selected.filter((test) => test.phase === phase)
        )
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }
)
