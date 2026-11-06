import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import AdmZip from 'adm-zip'

it('redacts step titles and failures before JSON, HTML and blob reporters serialize them', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cherry-report-redaction-'))
  const require = createRequire(import.meta.url)
  const secret = 'synthetic-provider-secret'
  const config = join(directory, 'playwright.config.ts')
  const blob = join(directory, 'report.zip')
  const html = join(directory, 'html')
  const json = join(directory, 'report.json')
  try {
    writeFileSync(
      config,
      `export default { testDir: ${JSON.stringify(directory)}, reporter: [
        [${JSON.stringify(resolve('scripts/e2e/regression/RedactionReporter.ts'))}],
        ['blob', { outputFile: ${JSON.stringify(blob)} }],
        ['html', { outputFolder: ${JSON.stringify(html)}, open: 'never' }],
        ['json', { outputFile: ${JSON.stringify(json)} }]
      ] }`
    )
    writeFileSync(
      join(directory, 'example.test.ts'),
      `const { test } = require(${JSON.stringify(require.resolve('@playwright/test'))});
      test('credential entry', async () => {
        const secret = process.env.CHERRY_TEST_CUSTOM_PROVIDER_API_KEY;
        await test.step('Fill "' + secret + '"', async () => { throw new Error('Entry failed: ' + secret); });
      });`
    )
    const result = spawnSync(process.execPath, [require.resolve('@playwright/test/cli'), 'test', '--config', config], {
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, CHERRY_TEST_CUSTOM_PROVIDER_API_KEY: secret }
    })
    expect(result.status, result.stdout + result.stderr).toBe(1)
    const report = JSON.parse(readFileSync(json, 'utf8'))
    expect(report.stats.unexpected).toBe(1)
    expect(readFileSync(json, 'utf8')).not.toContain(secret)
    const blobReport = new AdmZip(blob).getEntry('report.jsonl')!.getData().toString('utf8')
    expect(blobReport).not.toContain(secret)
    expect(blobReport).toContain('Fill \\"[REDACTED]\\"')
    expect(blobReport).toContain('Entry failed: [REDACTED]')
    const htmlSource = readFileSync(join(html, 'index.html'), 'utf8')
    const embedded = htmlSource.match(/<template id="playwrightReportBase64">data:application\/zip;base64,([^<]+)/)!
    const htmlReport = new AdmZip(Buffer.from(embedded[1], 'base64'))
    const entries = htmlReport.getEntries().filter((entry) => entry.entryName.endsWith('.json'))
    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) expect(entry.getData().toString('utf8')).not.toContain(secret)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}, 45_000)
