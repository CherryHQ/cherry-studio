import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import type { JSONReport, JSONReportSuite } from '@playwright/test/reporter'
import { parse } from 'yaml'

import { getCase, missingCapabilities, PHASE_IDS, REGRESSION_CASES, selectCases, TASK_SELECTIONS } from '../cases'

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

  it('allows only manual runs from the trusted main controller', () => {
    const workflow = parse(readFileSync(resolve('.github/workflows/e2e-regression-test.yml'), 'utf8'))
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch'])
    expect(workflow.jobs.resolve.if).toBe("github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'")
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
    expect(selectCases('knowledge', '06-knowledge').map(({ id }) => id)).toEqual(['K-01'])
    expect(selectCases('code-cli', '08-code-tools').map(({ id }) => id)).toEqual(['CODE-01', 'CODE-02'])
    expect(selectCases('notes', '03-models-and-assistants')).toEqual([])
    expect(selectCases('notes', '02-basic-features').map(({ id }) => id)).toEqual(['N-01'])
    expect(() => getCase('missing')).toThrow('Unknown regression case')
  })

  it('keeps each manifest phase executable by the workflow', () => {
    const workflow = parse(readFileSync(resolve('.github/workflows/e2e-regression-test.yml'), 'utf8'))
    const phases = workflow.jobs.test.steps
      .filter((step: { run?: string }) => step.run?.includes('cli.ts run-phase'))
      .map((step: { run: string }) => /--phase ([\w-]+)/.exec(step.run)?.[1])
    expect(phases).toEqual(PHASE_IDS)
    for (const phase of phases) {
      expect(existsSync(resolve(`tests/e2e/regression/${phase}.test.ts`))).toBe(true)
    }
  })

  it('blocks native interactions when desktop automation is missing without blocking pure UI tasks', () => {
    expect(missingCapabilities('C-02', { desktopAutomation: { available: false } })).toEqual(['desktopAutomation'])
    expect(missingCapabilities('C-02', {})).toEqual(['desktopAutomation'])
    expect(missingCapabilities('C-02', { desktopAutomation: { available: true } })).toEqual([])
    expect(missingCapabilities('N-01', {})).toEqual([])
  })
})

it('discovers each manifest case exactly once through Playwright with its phase and task tag', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cherry-regression-enumeration-'))
  try {
    const cli = createRequire(import.meta.url).resolve('@playwright/test/cli')
    const report = JSON.parse(
      execFileSync(
        process.execPath,
        [cli, 'test', '--config', 'playwright.regression.config.ts', '--list', '--reporter=json'],
        {
          encoding: 'utf8',
          timeout: 20_000,
          env: { ...process.env, CHERRY_TEST_RUN_DIR: directory }
        }
      )
    ) as JSONReport
    const collect = (suites: JSONReportSuite[]): Array<{ id: string | undefined; task: string; phase: string }> =>
      suites.flatMap((suite) => [
        ...suite.specs.flatMap((spec) =>
          spec.tests.map((test) => ({
            id: test.annotations.find(({ type }) => type === 'regression-case')?.description,
            task: spec.tags[0],
            phase: spec.file.replace('.test.ts', '')
          }))
        ),
        ...collect(suite.suites ?? [])
      ])
    expect(report.errors).toEqual([])
    expect(collect(report.suites)).toEqual(REGRESSION_CASES.map(({ id, task, phase }) => ({ id, task, phase })))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
