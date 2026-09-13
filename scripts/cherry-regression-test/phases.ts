import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

import { type PhaseId, selectCases } from './cases'
import type { RunPaths } from './paths'
import { readRun, updatePhase, writeRun } from './state'

const require = createRequire(import.meta.url)

export async function runPhase(paths: RunPaths, phase: PhaseId): Promise<void> {
  const run = readRun(paths.runState)
  if (selectCases(run.metadata.task, phase).length === 0) return
  writeRun(paths.runState, updatePhase(run, phase, 'running'))
  const args = ['test', '--config', 'cherry-regression.playwright.config.ts', `${phase}.test.ts`]
  if (run.metadata.task !== 'all') args.push('--grep', `@${run.metadata.task}(?:\\s|$)`)
  const code = await new Promise<number>((resolve) => {
    const child = spawn(process.execPath, [require.resolve('@playwright/test/cli'), ...args], {
      stdio: 'inherit',
      env: { ...process.env, CHERRY_TEST_RUN_DIR: paths.root, CHERRY_TEST_PHASE: phase }
    })
    child.once('error', () => resolve(1))
    child.once('exit', (exitCode) => resolve(exitCode ?? 1))
  })
  const result = readRun(paths.runState)
  if (code !== 0 || result.phases[phase].status !== 'passed') {
    writeRun(
      paths.runState,
      updatePhase(result, phase, 'failed', [code !== 0 ? `测试执行器异常退出（退出码 ${code}）` : '阶段未报告成功完成'])
    )
    process.exitCode = 1
  }
}
