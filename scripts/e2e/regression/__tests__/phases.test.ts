import * as childProcess from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { vi } from 'vitest'

import { createFixtures } from '../fixtureFiles'
import * as lifecycle from '../lifecycle'
import { ensureRunDirectories, getRunPaths } from '../paths'
import { runPhase } from '../phases'
import { completeE2eCase, createRun, getRunVerdict, readRun, updatePhase, writeRun } from '../state'

vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof childProcess>()
  return { ...original, spawn: vi.fn(original.spawn) }
})

it('keeps the shared application available across selected phases', async () => {
  const paths = getRunPaths(mkdtempSync(join(tmpdir(), 'cherry-combined-phase-')))
  const exitCode = process.exitCode
  ensureRunDirectories(paths)
  const server = createServer((_request, response) => response.end('owned application'))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const close = () => new Promise<void>((resolve) => server.close(() => resolve()))
  const spawn = vi.mocked(childProcess.spawn)
  const originalSpawn = spawn.getMockImplementation()!
  try {
    vi.spyOn(lifecycle, 'stopOwnedApp').mockImplementation(close)
    const phases = [
      { phase: 'startup', id: 'S-01' },
      { phase: 'basicFeatures', id: 'N-01' }
    ] as const
    let invocation = 0
    spawn.mockImplementation(() => {
      const child = new EventEmitter()
      const { phase, id } = phases[invocation++]
      queueMicrotask(async () => {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/`)
          if ((await response.text()) !== 'owned application') throw new Error('Application unavailable')
          writeRun(
            paths.runState,
            updatePhase(completeE2eCase(readRun(paths.runState), id, 'passed', 'Verified'), phase, 'passed')
          )
          child.emit('exit', 0)
        } catch {
          child.emit('exit', 1)
        }
      })
      return child as childProcess.ChildProcess
    })
    writeRun(
      paths.runState,
      createRun({
        appVersion: 'test',
        commitSha: 'sha',
        mode: 'branch',
        platform: 'macos',
        ref: 'main',
        runner: 'local',
        task: 'startup-smoke,notes-smoke'
      })
    )
    await runPhase(paths, 'startup')
    await runPhase(paths, 'basicFeatures')
    expect(getRunVerdict(readRun(paths.runState))).toBe('development_pass')
    expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toBe('owned application')
  } finally {
    spawn.mockImplementation(originalSpawn)
    vi.restoreAllMocks()
    await close()
    process.exitCode = exitCode
    rmSync(paths.root, { recursive: true, force: true })
  }
})

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
    await runPhase(paths, 'startup')
    const run = readRun(paths.runState)
    expect(run.cases['S-01'].status).toBe('failed')
    expect(run.phases['startup'].status).toBe('failed')
    expect(getRunVerdict(run)).toBe('development_failed')
    expect(process.exitCode).toBe(1)
  } finally {
    process.exitCode = exitCode
    rmSync(directory, { recursive: true, force: true })
  }
})
