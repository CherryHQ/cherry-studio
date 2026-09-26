import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import type { JSONReport } from '@playwright/test/reporter'

it('merges phase blobs without losing platform identity, failures, or attachments', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cherry-merged-report-'))
  const require = createRequire(import.meta.url)
  const cli = require.resolve('@playwright/test/cli')
  const config = join(directory, 'playwright.config.ts')
  const blobs = join(directory, 'blobs')
  const html = join(directory, 'html')
  const json = join(directory, 'merged.json')
  const env = {
    ...process.env,
    CHERRY_TEST_RUN_DIR: directory,
    PLAYWRIGHT_HTML_OUTPUT_DIR: html,
    PLAYWRIGHT_HTML_OPEN: 'never',
    PLAYWRIGHT_JSON_OUTPUT_FILE: json
  }
  const run = (args: string[]) =>
    spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env, timeout: 30_000 })
  try {
    writeFileSync(
      config,
      `export default { testDir: ${JSON.stringify(directory)}, projects: [{ name: 'macOS' }, { name: 'Windows' }] }`
    )
    writeFileSync(
      join(directory, 'example.test.ts'),
      `
      const { test, expect } = require(${JSON.stringify(require.resolve('@playwright/test'))});
      test('startup', async () => {});
      test('notes', async ({}, info) => {
        const path = info.outputPath('notes.txt');
        require('node:fs').writeFileSync(path, 'notes evidence');
        await info.attach('failure-evidence', { path, contentType: 'text/plain' });
        expect(info.project.name).toBe('macOS');
      });
    `
    )
    for (const project of ['macOS', 'Windows']) {
      for (const phase of ['startup', 'notes']) {
        const result = spawnSync(
          process.execPath,
          [cli, 'test', '--config', config, '--project', project, '--grep', `^.*${phase}$`, '--reporter', 'blob'],
          {
            encoding: 'utf8',
            timeout: 30_000,
            env: { ...env, PLAYWRIGHT_BLOB_OUTPUT_FILE: join(blobs, `${project}-${phase}.zip`) }
          }
        )
        expect(result.status, result.stdout + result.stderr).toBe(project === 'Windows' && phase === 'notes' ? 1 : 0)
      }
    }
    const merged = run([
      'merge-reports',
      '--config',
      resolve('playwright.regression.config.ts'),
      '--reporter',
      'html,json',
      blobs
    ])
    expect(merged.status, merged.stdout + merged.stderr).toBe(0)
    const report = JSON.parse(readFileSync(json, 'utf8')) as JSONReport
    expect(report.stats).toMatchObject({ expected: 3, unexpected: 1 })
    const tests = report.suites.flatMap((suite) => suite.specs.flatMap((spec) => spec.tests))
    expect(new Set(tests.map((test) => test.projectName))).toEqual(new Set(['macOS', 'Windows']))
    const attachments = tests
      .flatMap((test) => test.results.flatMap((result) => result.attachments))
      .filter(({ name }) => name === 'failure-evidence')
    expect(attachments).toHaveLength(2)
    for (const attachment of attachments) expect(readFileSync(attachment.path!, 'utf8')).toBe('notes evidence')
    expect(existsSync(join(html, 'index.html'))).toBe(true)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}, 60_000)
