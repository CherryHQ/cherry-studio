import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import type { JSONReport, JSONReportSuite } from '@playwright/test/reporter'
import { parse } from 'yaml'

import { getCase, missingCapabilities, PHASE_IDS, REGRESSION_CASES, selectCases } from '../cases'

describe('regression execution plan', () => {
  it('selects only the requested task within its workflow phase', () => {
    expect(selectCases('code-cli', '08-code-tools').map(({ id }) => id)).toEqual(['CODE-01', 'CODE-02'])
    expect(selectCases('notes', '03-models-and-assistants')).toEqual([])
    expect(selectCases('notes', '02-basic-features').map(({ id }) => id)).toEqual(['N-01'])
    expect(() => getCase('missing')).toThrow('Unknown regression case')
  })

  it('keeps each manifest phase executable by the workflow', () => {
    const workflow = parse(readFileSync(resolve('.github/workflows/cherry-regression-test.yml'), 'utf8'))
    const phases = workflow.jobs.test.steps
      .filter((step: { run?: string }) => step.run?.includes('cli.ts run-phase'))
      .map((step: { run: string }) => /--phase ([\w-]+)/.exec(step.run)?.[1])
    expect(phases).toEqual(PHASE_IDS)
    for (const phase of phases) {
      expect(existsSync(resolve(`tests/e2e/cherry-regression/${phase}.test.ts`))).toBe(true)
    }
  })

  it('blocks native interactions when desktop automation is missing without blocking pure UI tasks', () => {
    expect(missingCapabilities('C-03', { desktopAutomation: { available: false } })).toEqual(['desktopAutomation'])
    expect(missingCapabilities('C-03', {})).toEqual(['desktopAutomation'])
    expect(missingCapabilities('C-03', { desktopAutomation: { available: true } })).toEqual([])
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
        [cli, 'test', '--config', 'cherry-regression.playwright.config.ts', '--list', '--reporter=json'],
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
