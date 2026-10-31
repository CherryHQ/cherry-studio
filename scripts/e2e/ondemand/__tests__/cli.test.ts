import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { createResult, readResult, saveResult } from '../report'

function controller() {
  const directory = mkdtempSync(resolve(tmpdir(), 'qa-cli-'))
  const env = {
    ...process.env,
    QA_PLATFORM: 'macos',
    QA_MODE: 'branch',
    QA_PROFILE: 'clean',
    QA_SPEC: 'smoke',
    QA_PLAN: '',
    QA_TIMEOUT_MINUTES: '45',
    QA_RUN_DIR: directory,
    QA_OUT: resolve(directory, 'report'),
    GITHUB_OUTPUT: undefined
  }
  return {
    directory,
    env,
    execute: (command: string) =>
      spawnSync(process.execPath, [require.resolve('tsx/cli'), resolve(__dirname, '../run.ts'), command], {
        env,
        encoding: 'utf8',
        timeout: 10_000
      }).status,
    cleanup: () => rmSync(directory, { recursive: true, force: true })
  }
}

// Catch CLI boundaries reducing every failure to code 1 or inventing a pass.
it('emits code 2 and a v1 input report without resolving an invalid request', () => {
  const cli = controller()
  cli.env.QA_TIMEOUT_MINUTES = '5'
  try {
    expect(cli.execute('resolve')).toBe(2)
    expect(readResult(cli.env.QA_OUT)).toMatchObject({
      schemaVersion: 1,
      status: 'failed',
      exitCode: 2,
      failureStage: 'input'
    })
  } finally {
    cli.cleanup()
  }
})

it('classifies an unfinished preparation as code 2 during finalization', () => {
  const cli = controller()
  try {
    expect(cli.execute('initialize')).toBe(0)
    expect(readResult(cli.env.QA_OUT)).toMatchObject({ status: 'interrupted', exitCode: null, failureStage: 'prepare' })
    expect(cli.execute('finalize')).toBe(2)
    expect(readResult(cli.env.QA_OUT)).toMatchObject({ status: 'failed', exitCode: 2, failureStage: 'prepare' })
  } finally {
    cli.cleanup()
  }
})

it.each([
  { timezone: undefined, expected: 'Asia/Shanghai' },
  { timezone: 'UTC', expected: 'UTC' }
])('initializes timezone $expected with inherited TZ=$timezone', ({ timezone, expected }) => {
  const cli = controller()
  try {
    const initialized = spawnSync(
      process.execPath,
      [require.resolve('tsx/cli'), resolve(__dirname, '../run.ts'), 'initialize'],
      { env: { ...cli.env, TZ: timezone }, encoding: 'utf8', timeout: 10_000 }
    )
    expect(initialized.status).toBe(0)
    expect(readResult(cli.env.QA_OUT).environment.timezone).toMatchObject({
      inherited: expected,
      controller: expected
    })
  } finally {
    cli.cleanup()
  }
})

it('preserves a handled signal as interrupted after the next finalize process', () => {
  const cli = controller()
  try {
    const result = createResult(cli.env)
    result.metadata.interruptedAt = new Date().toISOString()
    result.failureStage = 'steps'
    saveResult(cli.env.QA_OUT, result)
    expect(cli.execute('finalize')).toBe(130)
    expect(readResult(cli.env.QA_OUT)).toMatchObject({ status: 'interrupted', exitCode: null, failureStage: 'steps' })
  } finally {
    cli.cleanup()
  }
})

it.each(['resolve', 'run'])('rejects missing authenticated credentials during %s', (command) => {
  const cli = controller()
  cli.env.QA_PROFILE = 'authenticated'
  try {
    expect(
      spawnSync(process.execPath, [require.resolve('tsx/cli'), resolve(__dirname, '../run.ts'), command], {
        env: {
          ...cli.env,
          GITHUB_REPOSITORY: 'invalid',
          CHERRY_TEST_CUSTOM_PROVIDER_BASE_URL: '',
          CHERRY_TEST_CUSTOM_PROVIDER_API_KEY: '',
          CHERRY_TEST_CUSTOM_PROVIDER_CHAT_MODEL: ''
        },
        encoding: 'utf8',
        timeout: 10_000
      }).status
    ).toBe(2)
    expect(readResult(cli.env.QA_OUT)).toMatchObject({
      status: 'failed',
      exitCode: 2,
      failureStage: command === 'resolve' ? 'input' : 'prepare',
      errors: [expect.objectContaining({ message: expect.stringContaining('apiKey') })]
    })
    expect(existsSync(resolve(cli.directory, 'app.json'))).toBe(false)
  } finally {
    cli.cleanup()
  }
})
