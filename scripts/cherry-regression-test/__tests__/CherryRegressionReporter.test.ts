import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { FullConfig, Suite, TestCase, TestResult } from '@playwright/test/reporter'
import { afterEach, beforeEach, vi } from 'vitest'

import CherryRegressionReporter from '../CherryRegressionReporter'
import { ensureRunDirectories, getRunPaths } from '../paths'
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
  it('preserves a global executor error even when every test and onEnd report passed', () => {
    vi.stubEnv('CHERRY_TEST_CUSTOM_PROVIDER_API_KEY', 'test-secret')
    const reporter = new CherryRegressionReporter()
    reporter.onBegin(config, suite)
    reporter.onTestBegin(startup)
    reporter.onTestEnd(startup, passed)
    reporter.onError({ message: 'teardown failed: test-secret' })
    reporter.onEnd({ status: 'passed', startTime: new Date(), duration: 10 })

    const run = readRun(getRunPaths(directory).runState)
    expect(getRunVerdict(run)).toBe('development_failed')
    expect(run.cases['S-01'].status).toBe('passed')
    expect(run.phases['01-startup'].errors).toEqual(['执行器错误：teardown failed: [REDACTED]'])
  })

  it('does not mutate run state during enumeration without test execution', () => {
    const before = readRun(getRunPaths(directory).runState)
    const reporter = new CherryRegressionReporter()
    reporter.onBegin(config, suite)
    reporter.onEnd({ status: 'passed', startTime: new Date(), duration: 10 })
    expect(readRun(getRunPaths(directory).runState)).toEqual(before)
  })

  it('records skipped capability requirements as blocked with their reason', () => {
    const reporter = new CherryRegressionReporter()
    reporter.onBegin(config, suite)
    reporter.onTestBegin(startup)
    reporter.onTestEnd(startup, {
      ...passed,
      status: 'skipped',
      annotations: [{ type: 'skip', description: '缺少运行能力：desktopAutomation' }]
    })
    reporter.onEnd({ status: 'passed', startTime: new Date(), duration: 10 })
    const run = readRun(getRunPaths(directory).runState)
    expect(getRunVerdict(run)).toBe('development_blocked')
    expect(run.cases['S-01'].summary).toContain('desktopAutomation')
  })
})
