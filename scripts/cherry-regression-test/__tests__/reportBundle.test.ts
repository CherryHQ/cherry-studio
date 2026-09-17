import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { parse } from 'yaml'

const workflow = parse(readFileSync('.github/workflows/cherry-regression-test.yml', 'utf8'))
const steps = workflow.jobs.aggregate.steps as Array<{ name: string; run?: string }>

describe('single regression artifact bundle', () => {
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
    spawnSync('bash', ['-e', '-o', 'pipefail', '-c', steps.find((step) => step.name === name)!.run!], {
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
