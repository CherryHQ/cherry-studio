import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestError,
  TestResult
} from '@playwright/test/reporter'

import { getCase, selectCases } from './cases'
import { REQUIRED_CONFIG } from './config'
import { getRunPaths } from './paths'
import { createRedactor } from './redaction'
import { beginCase, completeE2eCase, readRun, updatePhase, writeRun } from './state'

function caseId(test: TestCase): string {
  const id = test.annotations.find(({ type }) => type === 'regression-case')?.description
  if (!id) throw new Error(`Missing regression-case annotation: ${test.title}`)
  return getCase(id).id
}

export default class RegressionReporter implements Reporter {
  private readonly paths = getRunPaths(process.env.CHERRY_TEST_RUN_DIR ?? '')
  private readonly phases = new Set<string>()
  private readonly errors: string[] = []
  private readonly redact = createRedactor(REQUIRED_CONFIG.map((name) => process.env[name] ?? ''))
  private started = false
  private ids: string[] = []

  onBegin(_config: FullConfig, suite: Suite): void {
    this.ids = suite.allTests().map(caseId)
    if (new Set(this.ids).size !== this.ids.length) throw new Error('Duplicate regression-case annotation')
    for (const id of this.ids) this.phases.add(getCase(id).phase)
  }

  onTestBegin(test: TestCase): void {
    let run = readRun(this.paths.runState)
    if (!this.started) {
      this.started = true
      for (const phase of this.phases) {
        const expected = selectCases(run.metadata.task).filter((testCase) => testCase.phase === phase)
        if (expected.length === 0 || expected.some(({ id }) => !this.ids.includes(id))) {
          this.errors.push(`Registered cases for phase ${phase} do not match the selected task`)
        }
        run = updatePhase(run, phase, 'running')
      }
    }
    writeRun(this.paths.runState, beginCase(run, caseId(test)))
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const artifacts = result.attachments.flatMap(({ path }) => (path ? [path] : []))
    const status = result.status === 'passed' ? 'passed' : result.status === 'skipped' ? 'blocked' : 'failed'
    const blocked = result.annotations.find(({ type }) => type === 'skip')?.description
    const summary =
      result.status === 'passed'
        ? `End-to-end test passed in ${Math.ceil(result.duration / 1000)} seconds`
        : result.status === 'skipped'
          ? `Prerequisites not met: ${blocked ?? 'See phase logs'}`
          : 'End-to-end test failed; see phase logs and the HTML report'
    const run = completeE2eCase(readRun(this.paths.runState), caseId(test), status, this.redact(summary), artifacts)
    writeRun(this.paths.runState, run)
  }

  onError(error: TestError): void {
    this.errors.push(this.redact(`Executor error: ${error.message ?? error.value ?? 'Unknown error'}`))
  }

  onEnd(result: FullResult): void {
    if (!this.started) return
    let run = readRun(this.paths.runState)
    for (const phase of this.phases) {
      run = updatePhase(
        run,
        phase,
        result.status === 'passed' && this.errors.length === 0 ? 'passed' : 'failed',
        this.errors
      )
    }
    writeRun(this.paths.runState, run)
    process.stdout.write(
      `End-to-end phase verdict: ${result.status === 'passed' && this.errors.length === 0 ? 'Passed' : 'Failed'}\n`
    )
  }
}
