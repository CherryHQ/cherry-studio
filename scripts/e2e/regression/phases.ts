import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

import { type PhaseId, selectCases, supportsPlatform } from './cases'
import { stopOwnedApp } from './lifecycle'
import { verifyMockProvider } from './mockProvider'
import type { RunPaths } from './paths'
import { readRun, updatePhase, writeRun } from './state'

const require = createRequire(import.meta.url)

export async function runPhase(paths: RunPaths, phase: PhaseId): Promise<void> {
  const run = readRun(paths.runState)
  const selected = selectCases(run.metadata.task, phase).filter(({ id }) => supportsPlatform(id, run.metadata.platform))
  if (selected.length === 0) return
  if (run.metadata.providerMode === 'mock') await verifyMockProvider(paths)
  writeRun(paths.runState, updatePhase(run, phase, 'running'))
  const args = ['test', '--config', 'playwright.regression.config.ts', `phases/${phase}.test.ts`]
  if (run.metadata.task !== 'all') args.push('--grep', `@${run.metadata.task}(?:\\s|$)`)
  const code = await new Promise<number>((resolve) => {
    const child = spawn(process.execPath, [require.resolve('@playwright/test/cli'), ...args], {
      stdio: 'inherit',
      env: { ...process.env, CHERRY_TEST_RUN_DIR: paths.root, CHERRY_TEST_PHASE: phase }
    })
    child.once('error', () => resolve(1))
    child.once('exit', (exitCode) => resolve(exitCode ?? 1))
  })
  // Every invocation of `run-phase` owns the app it launched: leaving it running leaks a window,
  // a renderer, its CDP ports and any native dialog it opened into the next run.
  try {
    await stopOwnedApp(paths)
  } catch (error) {
    // A failed teardown is reported, not turned into a case verdict: the shared inspector port can
    // be held by an unrelated run, and that must not fail a phase whose tests already finished.
    process.stderr.write(`[cleanup] ${error instanceof Error ? error.message : String(error)}\n`)
  }
  const result = readRun(paths.runState)
  if (code !== 0 || result.phases[phase].status !== 'passed') {
    writeRun(
      paths.runState,
      updatePhase(result, phase, 'failed', [
        code !== 0 ? `Test executor exited abnormally (exit code ${code})` : 'Phase did not report successful completion'
      ])
    )
    process.exitCode = 1
  }
}
