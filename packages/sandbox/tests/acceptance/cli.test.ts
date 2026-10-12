import { execFileSync } from 'node:child_process'
import {
  closeSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest'

import { runCli, type CliResult } from '../cliDriver.js'

let fixtureRoot: string
let executable: string
let root: string
let allowed: string
let input: string

beforeAll(() => {
  fixtureRoot = realpathSync(mkdtempSync(join(tmpdir(), 'sandbox-cli-fixture-')))
  executable = join(fixtureRoot, 'file-access')
  if (process.platform === 'darwin') {
    execFileSync(
      '/usr/bin/xcrun',
      [
        'clang',
        '-std=c11',
        '-Wall',
        '-Wextra',
        '-Werror',
        fileURLToPath(new URL('../fixtures/fileAccess.c', import.meta.url)),
        '-o',
        executable
      ],
      { timeout: 10000 }
    )
  }
})
afterAll(() => {
  if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true })
})
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'sandbox-cli-acceptance-')))
  allowed = join(root, 'allowed')
  mkdirSync(allowed)
  input = join(allowed, 'input')
  writeFileSync(input, 'permitted content\n')
})
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true })
})

async function requireReady(options: string[], operation: string[]) {
  if (process.platform !== 'darwin')
    throw new Error(`ACCEPTANCE_BLOCKED: this runtime fixture requires macOS, got ${process.platform}`)
  const args = [...options, '--timeout-ms', '2000', '--', executable, ...operation]
  const probe = await runCli(['probe', ...args])
  if (probe.code !== 0)
    throw new Error(`ACCEPTANCE_BLOCKED: CLI backend is not ready.\n${probe.stdout}\n${probe.stderr}`)
  expect(JSON.parse(probe.stdout).status).toBe('ready')
  return args
}

function expectCompleted(result: CliResult, exitCode: number) {
  expect(result.signal).toBeNull()
  expect(result.code).toBe(exitCode)
  const report = JSON.parse(result.stderr.trim().split('\n').at(-1)!)
  expect(report.completion).toMatchObject({
    reason: 'exited',
    target: { status: 'exited', exitCode },
    tree: 'unverified',
    cleanup: 'complete',
    issues: []
  })
}

it('reads an authorized file through CLI -> manager -> native backend', async () => {
  const args = await requireReady(['--read', allowed], ['read', input])
  const result = await runCli(['run', ...args])
  expectCompleted(result, 0)
  expect(result.stdout).toBe('permitted content\n')
})

it('writes the original authorized file and makes the change visible to an existing host descriptor', async () => {
  const args = await requireReady(['--write', allowed], ['write', input, 'updated by sandbox\n'])
  const original = statSync(input)
  const descriptor = openSync(input, 'r')
  try {
    const result = await runCli(['run', ...args])
    expectCompleted(result, 0)
    expect(readFileSync(descriptor, 'utf8')).toBe('updated by sandbox\n')
    expect(readFileSync(input, 'utf8')).toBe('updated by sandbox\n')
    expect(statSync(input).ino).toBe(original.ino)
  } finally {
    closeSync(descriptor)
  }
})

it('denies an outside read after the same executable successfully reads inside its grant', async () => {
  const outside = join(root, 'outside')
  writeFileSync(outside, 'private fixture\n')
  const args = await requireReady(['--read', allowed], ['read', input])
  const control = await runCli(['run', ...args])
  expectCompleted(control, 0)
  expect(control.stdout).toBe('permitted content\n')
  const denied = await runCli(['run', '--read', allowed, '--timeout-ms', '2000', '--', executable, 'read', outside])
  expectCompleted(denied, 77)
  expect(denied.stdout).toBe('PERMISSION_DENIED\n')
  expect(readFileSync(outside, 'utf8')).toBe('private fixture\n')
})
