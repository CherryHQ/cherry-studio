import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createFixtures } from '../fixtureFiles'
import { ensureRunDirectories, getRunPaths } from '../paths'
import { runPhase } from '../phases'
import { createRun, getRunVerdict, readRun, writeRun } from '../state'

it('fails the platform gate when the real Playwright subprocess cannot acquire its owned application', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cherry-phase-'))
  const paths = getRunPaths(directory)
  const exitCode = process.exitCode
  ensureRunDirectories(paths)
  try {
    await createFixtures(paths)
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
    await runPhase(paths, '01-startup')
    const run = readRun(paths.runState)
    expect(run.cases['S-01'].status).toBe('failed')
    expect(run.phases['01-startup'].status).toBe('failed')
    expect(getRunVerdict(run)).toBe('development_failed')
    expect(process.exitCode).toBe(1)
  } finally {
    process.exitCode = exitCode
    rmSync(directory, { recursive: true, force: true })
  }
})
