import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { FullConfig, Suite, TestCase, TestResult } from '@playwright/test/reporter'
import { afterEach, beforeEach, vi } from 'vitest'

import { ensureRunDirectories, getRunPaths } from '../paths'
import RegressionReporter from '../RegressionReporter'
import { createRun, getRunVerdict, readRun, writeRun } from '../state'

let directory: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'cherry-reporter-'))
  vi.stubEnv('CHERRY_TEST_RUN_DIR', directory)
  const paths = getRunPaths(directory)
  ensureRunDirectories(paths)
  writeRun(
    paths.runState,
    createRun({
      appVersion: 'development',
      mockVersion: '1.46.0',
      commitSha: 'sha',
      mode: 'branch',
      platform: 'macos',
      ref: 'main',
      runner: 'macos-latest',
      task: 'startup-smoke'
    })
  )
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(directory, { recursive: true, force: true })
})

const startup = {
  title: 'Startup',
  annotations: [{ type: 'regression-case', description: 'S-01' }]
} as TestCase
const passed = { status: 'passed', duration: 10, attachments: [], annotations: [] } as unknown as TestResult
const config = {} as FullConfig
const suite = { allTests: () => [startup] } as Suite

describe('Playwright reporter contract', () => {
  it('accepts the deduplicated cases of a combined task without reporting missing registrations', () => {
    const paths = getRunPaths(directory)
    const run = readRun(paths.runState)
    writeRun(paths.runState, createRun({ ...run.metadata, task: 'startup-smoke,notes-smoke,notes-smoke' }))
    const note = { title: 'Note', annotations: [{ type: 'regression-case', description: 'N-01' }] } as TestCase
    const reporter = new RegressionReporter()
    reporter.onBegin(config, { allTests: () => [startup, note] } as Suite)
    for (const test of [startup, note]) {
      reporter.onTestBegin(test)
      reporter.onTestEnd(test, passed)
    }
    reporter.onEnd({ status: 'passed', startTime: new Date(), duration: 10 })
    expect(getRunVerdict(readRun(paths.runState))).toBe('mock_pass')
    expect(readRun(paths.runState).metadata.task).toBe('startup-smoke,notes-smoke')
    expect(readRun(paths.runState).cases['APP-01'].status).toBe('not_applicable')
  })

  it('retains the case fixture provenance and redacts sensitive values before reporting it', () => {
    const reporter = new RegressionReporter()
    reporter.onBegin(config, suite)
    reporter.onTestBegin(startup)
    reporter.onTestEnd(startup, {
      ...passed,
      annotations: [{ type: 'data-source', description: 'Mock fixture mock-key-not-checked; real UI' }]
    })
    const run = readRun(getRunPaths(directory).runState)
    expect(run.cases['S-01'].dataSources).toEqual(['Mock fixture [REDACTED]; real UI'])
  })
  it('preserves a global executor error even when every test and onEnd report passed', () => {
    const reporter = new RegressionReporter()
    reporter.onBegin(config, suite)
    reporter.onTestBegin(startup)
    reporter.onTestEnd(startup, passed)
    reporter.onError({ message: 'teardown failed: mock-key-not-checked' })
    reporter.onEnd({ status: 'passed', startTime: new Date(), duration: 10 })

    const run = readRun(getRunPaths(directory).runState)
    expect(getRunVerdict(run)).toBe('mock_failed')
    expect(run.cases['S-01'].status).toBe('passed')
    expect(run.phases['startup'].errors).toEqual(['Executor error: teardown failed: [REDACTED]'])
  })

  it('records the executed selection so a rerun verdict does not depend on a separate --list', () => {
    // TOOL-20261117-01: the ids come from the run that produced the case statuses, not from a
    // `playwright test --list` collected before/after it.
    const reporter = new RegressionReporter()
    reporter.onBegin(config, suite)
    reporter.onTestBegin(startup)
    reporter.onTestEnd(startup, passed)
    reporter.onEnd({ status: 'passed', startTime: new Date(), duration: 10 })
    const run = readRun(getRunPaths(directory).runState)
    expect(run.selections?.startup?.ids).toEqual(['S-01'])
    expect(run.selections?.startup?.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('keeps a collected case that never began in the selection record', () => {
    // A case that never reached onTestBegin/onTestEnd must still appear in the selection record, so
    // judging the run by that record cannot pass on "nothing was checked".
    const paths = getRunPaths(directory)
    const startRun = readRun(paths.runState)
    writeRun(paths.runState, createRun({ ...startRun.metadata, task: 'all' }))
    const pairing = { title: 'Pairing', annotations: [{ type: 'regression-case', description: 'MP-141' }] } as TestCase
    const reporter = new RegressionReporter()
    reporter.onBegin(config, { allTests: () => [startup, pairing] } as Suite)
    reporter.onTestBegin(startup)
    reporter.onEnd({ status: 'failed', startTime: new Date(), duration: 10 })
    const run = readRun(paths.runState)
    expect(run.selections?.startup?.ids).toEqual(['S-01'])
    expect(run.selections?.system?.ids).toEqual(['MP-141'])
    expect(run.cases['MP-141'].status).toBe('pending')
  })

  it('persists the selection when the first collected case is not applicable', () => {
    // The first collected case can be outside the selected task, so onTestBegin returns early; the
    // record must already be on disk or the whole execution loses its selection evidence.
    const paths = getRunPaths(directory)
    const startRun = readRun(paths.runState)
    writeRun(paths.runState, createRun({ ...startRun.metadata, task: 'mini-app-smoke' }))
    const note = { title: 'Note', annotations: [{ type: 'regression-case', description: 'N-01' }] } as TestCase
    const miniApp = { title: 'Mini App', annotations: [{ type: 'regression-case', description: 'APP-01' }] } as TestCase
    const reporter = new RegressionReporter()
    reporter.onBegin(config, { allTests: () => [note, miniApp] } as Suite)
    reporter.onTestBegin(note)
    const run = readRun(paths.runState)
    expect(run.cases['N-01'].status).toBe('not_applicable')
    expect(run.selections?.basicFeatures?.ids).toEqual(['N-01', 'APP-01'])
  })

  it('does not mutate run state during enumeration without test execution', () => {
    const before = readRun(getRunPaths(directory).runState)
    const reporter = new RegressionReporter()
    reporter.onBegin(config, suite)
    reporter.onEnd({ status: 'passed', startTime: new Date(), duration: 10 })
    expect(readRun(getRunPaths(directory).runState)).toEqual(before)
    expect(readRun(getRunPaths(directory).runState).selections).toBeUndefined()
  })

  it('records skipped capability requirements as blocked with their reason', () => {
    const reporter = new RegressionReporter()
    reporter.onBegin(config, suite)
    reporter.onTestBegin(startup)
    reporter.onTestEnd(startup, {
      ...passed,
      status: 'skipped',
      annotations: [{ type: 'skip', description: 'Missing capabilities: desktopAutomation' }]
    })
    reporter.onEnd({ status: 'passed', startTime: new Date(), duration: 10 })
    const run = readRun(getRunPaths(directory).runState)
    expect(getRunVerdict(run)).toBe('mock_blocked')
    expect(run.cases['S-01'].summary).toContain('desktopAutomation')
  })
})
