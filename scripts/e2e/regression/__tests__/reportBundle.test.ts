import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { runInNewContext } from 'node:vm'

import which from 'which'
import { parse } from 'yaml'

const workflow = parse(readFileSync('.github/workflows/e2e-regression-test.yml', 'utf8'))
const steps = workflow.jobs.aggregate.steps as Array<{ name: string; run?: string }>
const bash =
  which.sync('bash', { nothrow: true }) ??
  (process.platform === 'win32' ? join(dirname(which.sync('git')), '..', 'bin', 'bash.exe') : 'bash')

describe('desktop regression and smoke report bundle', () => {
  it('publishes sanitized regression evidence independently of smoke', () => {
    const platformSteps = workflow.jobs.test.steps
    const finalize = platformSteps.find((step: { id?: string }) => step.id === 'platform_report')
    const upload = platformSteps.find((step: { name: string }) => step.name === 'Upload platform report and evidence')
    const smokeUpload = workflow.jobs.smoke.steps.find(
      (step: { name: string }) => step.name === 'Upload standalone smoke report and evidence'
    )
    expect(workflow.jobs.test.needs).not.toContain('smoke')
    expect(platformSteps.indexOf(finalize)).toBeLessThan(platformSteps.indexOf(upload))
    expect(finalize.run).toContain('cli.ts finalize --run-dir "$RUN_DIR"')
    expect(finalize.env).toBeUndefined()
    for (const outcome of ['success', 'failure', 'skipped', 'cancelled']) {
      expect(runInNewContext(upload.if, { always: () => true, steps: { platform_report: { outcome } } })).toBe(
        outcome === 'success'
      )
      expect(runInNewContext(smokeUpload.if, { always: () => true, steps: { smoke: { outcome } } })).toBe(
        outcome === 'success' || outcome === 'failure'
      )
    }
    expect(upload.with.name).toBe('test-evidence-${{ matrix.platform }}')
    expect(smokeUpload.with.name).toBe('smoke-evidence-${{ matrix.platform }}')
    expect(upload.with.path.trim().split('\n')).toEqual(
      ['report', 'evidence', 'agent-workspace', 'fixtures', 'release/installation.json'].map(
        (path) => `\${{ runner.temp }}/cherry-regression/${path}`
      )
    )
    expect(smokeUpload.with.path.trim().split('\n')).toEqual(
      ['report', 'evidence'].map((path) => `\${{ runner.temp }}/cherry-regression/${path}`)
    )
  })

  it('checks selected suite outcomes even when the other suite passes', () => {
    const gate = workflow.jobs.aggregate.steps.find(
      (step: { name: string }) => step.name === 'Validate aggregate result'
    )
    expect(gate['continue-on-error']).not.toBe(true)
    expect(runInNewContext(gate.if, { always: () => true })).toBe(true)
    expect(workflow.jobs.aggregate.needs).toEqual(['resolve', 'test', 'smoke'])
    expect(
      runInNewContext(workflow.jobs.aggregate.if, { always: () => true, needs: { resolve: { result: 'success' } } })
    ).toBe(true)
    for (const [regression, smoke, testResult, smokeResult, reportStatus, expected] of [
      ['true', 'all', 'success', 'success', 0, true],
      ['true', 'all', 'failure', 'success', 0, false],
      ['true', 'all', 'success', 'failure', 0, false],
      ['true', 'all', 'success', 'cancelled', 0, false],
      ['true', 'all', 'skipped', 'skipped', 0, false],
      ['true', 'all', 'success', 'success', 1, false],
      ['true', 'none', 'success', 'skipped', 0, true],
      ['false', 'all', 'skipped', 'success', 1, true]
    ] as const) {
      const execution = spawnSync(
        bash,
        ['-e', '-o', 'pipefail', '-c', `pnpm() { return ${reportStatus}; }\n${gate.run}`],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            TEST_RESULT: testResult,
            SMOKE_RESULT: smokeResult,
            RUN_REGRESSION: regression,
            RUN_SMOKE: smoke
          }
        }
      )
      expect(execution.status === 0).toBe(expected)
    }
  })

  let directory: string
  const write = (path: string, content: string) => {
    const target = join(directory, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
  const runStep = (name: string, regression = 'true', smoke = 'none') =>
    spawnSync(bash, ['-e', '-o', 'pipefail', '-c', steps.find((step) => step.name === name)!.run!], {
      cwd: directory,
      encoding: 'utf8',
      env: { ...process.env, RUN_REGRESSION: regression, RUN_SMOKE: smoke, SMOKE_SCOPE: smoke }
    })

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'cherry-report-bundle-'))
  })
  afterEach(() => rmSync(directory, { recursive: true, force: true }))

  it('retains both platforms and HTML attachments without overwriting the summary', () => {
    for (const platform of ['macos', 'windows']) {
      write(`downloaded-reports/test-evidence-${platform}/report/results.json`, '{}')
      write(`downloaded-reports/test-evidence-${platform}/evidence/logs/app.log`, platform)
      write(`downloaded-reports/smoke-evidence-${platform}/report/smoke-results.json`, '{}')
      write(`downloaded-reports/smoke-evidence-${platform}/report/smoke/index.html`, `smoke ${platform}`)
    }
    write('combined-report/combined-report.md', 'Summary')
    write('combined-report/combined-results.json', '{}')
    write('merged-html/index.html', '<a href="data/evidence.txt">Evidence</a>')
    write('merged-html/data/evidence.txt', 'Attachment')
    expect(runStep('Collect platform evidence', 'true', 'all').status).toBe(0)
    expect(runStep('Assemble complete report', 'true', 'all').status).toBe(0)
    expect(readFileSync(join(directory, 'combined-report/summary.md'), 'utf8')).toBe('Summary')
    expect(readFileSync(join(directory, 'combined-report/data/evidence.txt'), 'utf8')).toBe('Attachment')
    for (const platform of ['macos', 'windows']) {
      expect(readFileSync(join(directory, `combined-report/evidence/${platform}/evidence/logs/app.log`), 'utf8')).toBe(
        platform
      )
    }
  })

  it('bundles smoke-only reports without regression results and requires evidence from both platforms', () => {
    write('combined-report/combined-report.md', 'Smoke summary')
    write('platform-reports/macos/report/smoke-results.json', '{}')
    write('platform-reports/macos/report/smoke/index.html', 'macOS evidence')
    expect(runStep('Assemble complete report', 'false', 'all').status).not.toBe(0)

    write('platform-reports/windows/report/smoke-results.json', '{}')
    write('platform-reports/windows/report/smoke/index.html', 'Windows evidence')
    expect(runStep('Assemble complete report', 'false', 'all').status).toBe(0)
    expect(readFileSync(join(directory, 'combined-report/index.html'), 'utf8')).toContain(
      'evidence/windows/report/smoke/index.html'
    )
    expect(readFileSync(join(directory, 'combined-report/summary.md'), 'utf8')).toBe('Smoke summary')
    expect(existsSync(join(directory, 'combined-report/combined-results.json'))).toBe(false)
  })

  it('cannot substitute an older aggregate bundle for a missing suite report', () => {
    for (const platform of ['macos', 'windows']) {
      write(`downloaded-reports/test-evidence-${platform}/report/results.json`, '{}')
    }
    write('downloaded-reports/smoke-evidence-macos/report/smoke-results.json', '{}')
    write('downloaded-reports/smoke-evidence-macos/report/smoke/index.html', 'macOS evidence')
    write('downloaded-reports/test-report/evidence/windows/report/smoke-results.json', '{}')
    write('downloaded-reports/test-report/evidence/windows/report/smoke/index.html', 'Previous Windows evidence')

    expect(runStep('Collect platform evidence', 'true', 'all').status).toBe(0)
    expect(existsSync(join(directory, 'platform-reports/windows/report/smoke-results.json'))).toBe(false)
    expect(runStep('Assemble complete report', 'true', 'all').status).not.toBe(0)
  })
})
