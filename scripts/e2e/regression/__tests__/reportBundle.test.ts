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

describe('single regression artifact bundle', () => {
  it('publishes a checkpoint before smoke only after successful sanitization, including tolerated failures', () => {
    const platformSteps = workflow.jobs.test.steps
    const generate = platformSteps.find((step: { id?: string }) => step.id === 'regression_checkpoint')
    const upload = platformSteps.find((step: { name: string }) => step.name === 'Upload regression checkpoint')
    const finalUpload = platformSteps.find(
      (step: { name: string }) => step.name === 'Upload platform report and evidence'
    )
    const smoke = platformSteps.find((step: { name: string }) => step.name === 'Run standalone smoke suite')
    expect(platformSteps.indexOf(generate)).toBeLessThan(platformSteps.indexOf(upload))
    expect(platformSteps.indexOf(upload)).toBeLessThan(platformSteps.indexOf(smoke))
    for (const cancelled of [false, true]) {
      for (const outcome of ['success', 'failure', 'skipped', 'cancelled']) {
        for (const [step, dependency, skipsCancelled] of [
          [generate, 'smoke-build', true],
          [upload, 'regression_checkpoint', true],
          [finalUpload, 'platform_report', false]
        ] as const) {
          const context = {
            always: () => true,
            cancelled: () => cancelled,
            steps: {
              'smoke-build': { outcome: 'success', conclusion: 'success' },
              regression_checkpoint: { outcome: 'success', conclusion: 'success' },
              platform_report: { outcome: 'success', conclusion: 'success' }
            }
          }
          context.steps[dependency].outcome = outcome
          expect(runInNewContext(step.if, context)).toBe(outcome === 'success' && !(cancelled && skipsCancelled))
        }
      }
    }
  })

  it('uses the same credential redaction and public evidence roots for checkpoint and final uploads', () => {
    const platformSteps = workflow.jobs.test.steps
    const generate = platformSteps.find((step: { id?: string }) => step.id === 'regression_checkpoint')
    const final = platformSteps.find((step: { id?: string }) => step.id === 'platform_report')
    expect(generate.run).toContain('cli.ts finalize --run-dir "$RUN_DIR"')
    expect(final.run).toBe(generate.run)
    for (const step of [generate, final]) {
      expect(Object.keys(step.env).sort()).toEqual([
        'CHERRY_TEST_CHERRYIN_ACCOUNT',
        'CHERRY_TEST_CHERRYIN_PASSWORD',
        'CHERRY_TEST_CUSTOM_PROVIDER_API_KEY',
        'CHERRY_TEST_CUSTOM_PROVIDER_EMBEDDING_API_KEY'
      ])
      for (const [name, value] of Object.entries(step.env)) expect(value).toBe(`\${{ secrets.${name} }}`)
    }
    for (const name of ['Upload regression checkpoint', 'Upload platform report and evidence']) {
      const upload = platformSteps.find((step: { name: string }) => step.name === name)
      expect(upload.with.name).toBe('test-evidence-${{ matrix.platform }}')
      expect(upload.with.overwrite).toBe(true)
      expect(upload.with['include-hidden-files']).not.toBe(true)
      expect(upload.with.path.trim().split('\n')).toEqual(
        ['report', 'evidence', 'agent-workspace', 'fixtures', 'release/installation.json'].map(
          (path) => `\${{ runner.temp }}/cherry-regression/${path}`
        )
      )
    }
  })

  it('keeps final reports and gates mandatory and rejects failed smoke jobs even when regression passes', () => {
    const platformSteps = workflow.jobs.test.steps
    expect(
      platformSteps
        .filter((step: { 'continue-on-error'?: boolean }) => step['continue-on-error'])
        .map((step: { name: string }) => step.name)
    ).toEqual(['Generate regression checkpoint', 'Upload regression checkpoint'])
    const aggregateGate = workflow.jobs.aggregate.steps.find(
      (step: { name: string }) => step.name === 'Validate aggregate result'
    )
    expect(aggregateGate['continue-on-error']).not.toBe(true)
    expect(runInNewContext(aggregateGate.if, { always: () => true })).toBe(true)
    for (const result of ['success', 'failure', 'cancelled']) {
      const execution = spawnSync(bash, ['-e', '-o', 'pipefail', '-c', `pnpm() { return 0; }\n${aggregateGate.run}`], {
        encoding: 'utf8',
        env: { ...process.env, TEST_RESULT: result }
      })
      expect(execution.status === 0).toBe(result === 'success')
    }
  })

  it('requires a resolved target and a non-skipped test job while retaining failed-run reports', () => {
    expect(workflow.jobs.aggregate.if).toBe(
      "always() && needs.resolve.result == 'success' && needs.test.result != 'skipped'"
    )
  })

  let directory: string
  const write = (path: string, content: string) => {
    const target = join(directory, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
  const runStep = (name: string, result = 'success') =>
    spawnSync(bash, ['-e', '-o', 'pipefail', '-c', steps.find((step) => step.name === name)!.run!], {
      cwd: directory,
      encoding: 'utf8',
      env: { ...process.env, TEST_RESULT: result }
    })

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'cherry-report-bundle-'))
  })
  afterEach(() => rmSync(directory, { recursive: true, force: true }))

  it('retains both platforms and HTML attachments without overwriting the summary', () => {
    for (const platform of ['macos', 'windows']) {
      write(`downloaded-reports/test-evidence-${platform}/report/results.json`, '{}')
      write(`downloaded-reports/test-evidence-${platform}/evidence/logs/app.log`, platform)
    }
    write('combined-report/combined-report.md', 'Summary')
    write('combined-report/combined-results.json', '{}')
    write('merged-html/index.html', '<a href="data/evidence.txt">Evidence</a>')
    write('merged-html/data/evidence.txt', 'Attachment')
    expect(runStep('Collect platform evidence').status).toBe(0)
    expect(runStep('Assemble complete report').status).toBe(0)
    expect(readFileSync(join(directory, 'combined-report/summary.md'), 'utf8')).toBe('Summary')
    expect(readFileSync(join(directory, 'combined-report/data/evidence.txt'), 'utf8')).toBe('Attachment')
    for (const platform of ['macos', 'windows']) {
      expect(readFileSync(join(directory, `combined-report/evidence/${platform}/evidence/logs/app.log`), 'utf8')).toBe(
        platform
      )
    }
  })

  it('prefers fresh evidence and recovers successful unchanged platforms on rerun', () => {
    write('downloaded-reports/test-evidence-macos/report/results.json', 'fresh')
    for (const platform of ['macos', 'windows']) {
      write(`downloaded-reports/test-report/evidence/${platform}/report/results.json`, 'previous')
    }
    expect(runStep('Collect platform evidence').status).toBe(0)
    expect(readFileSync(join(directory, 'platform-reports/macos/report/results.json'), 'utf8')).toBe('fresh')
    expect(readFileSync(join(directory, 'platform-reports/windows/report/results.json'), 'utf8')).toBe('previous')
  })

  it('does not hide failed jobs behind old evidence or assemble an incomplete bundle', () => {
    write('downloaded-reports/test-report/evidence/windows/report/results.json', 'previous')
    expect(runStep('Collect platform evidence', 'failure').status).toBe(0)
    expect(existsSync(join(directory, 'platform-reports/windows'))).toBe(false)
    expect(runStep('Assemble complete report').status).not.toBe(0)
  })
})
