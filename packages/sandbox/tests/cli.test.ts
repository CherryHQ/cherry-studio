import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, expect, it } from 'vitest'

import { SandboxManager } from '@cherrystudio/sandbox'

import { runCli as run } from './cliDriver.js'
import { spec } from './fixtures.js'

let root: string
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'sandbox-cli-')))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

it.skipIf(!['darwin', 'win32'].includes(process.platform))(
  'reports the same backend assessment and filesystem grants as the public API',
  async () => {
    const request = spec()
    request.command.cwd = root
    request.filesystem.read = [root]
    const sandbox = new SandboxManager()
    try {
      const assessment = await sandbox.probe(request)
      const result = await run(['probe', '--cwd', root, '--read', root, '--', request.command.executable])
      const report = JSON.parse(result.stdout)
      expect(result.code).toBe(0)
      expect(report.status).toBe('ready')
      expect(report.backend).toEqual(assessment.backend)
      expect(report.checks).toEqual(assessment.checks)
      if (process.platform === 'darwin') {
        expect(report.policyPreview.filesystem).toEqual(request.filesystem)
        expect(report.policyPreview.limitations).toContainEqual(expect.stringContaining('hard-link'))
      }
    } finally {
      await sandbox.dispose()
    }
  }
)

it.skipIf(!['darwin', 'win32'].includes(process.platform))(
  'runs through the same public backend without prior probe',
  async () => {
    const request =
      process.platform === 'darwin'
        ? spec('/bin/bash', ['-c', 'printf executed > "$1"', 'test', join(root, 'marker')])
        : spec(process.execPath, [
            '-e',
            'require("node:fs").writeFileSync(process.argv[1], "executed")',
            join(root, 'marker')
          ])
    request.command.cwd = root
    request.filesystem.write = [root]
    const sandbox = new SandboxManager()
    try {
      const instance = sandbox.start(request)
      await instance.ready
      const completion = await instance.completion
      const result = await run([
        'run',
        '--cwd',
        root,
        '--write',
        root,
        '--',
        request.command.executable,
        ...request.command.args
      ])
      expect(result.code).toBe(0)
      expect(result.stdout).toBe('')
      expect(JSON.parse(result.stderr).completion).toEqual(completion)
      expect(completion.target.status).toBe('exited')
      expect(readFileSync(join(root, 'marker'), 'utf8')).toBe('executed')
    } finally {
      await sandbox.dispose()
    }
  }
)

it('uses API validation for invalid limits and refuses CLI bypass options', async () => {
  const executable = spec().command.executable
  const invalid = await run(['run', '--cwd', root, '--timeout-ms', '0', '--', executable])
  expect(invalid.code).toBe(125)
  expect(JSON.parse(invalid.stderr).completion).toMatchObject({
    target: { status: 'not-started' },
    issues: [{ code: 'INVALID_SPEC' }]
  })
  const bypass = await run(['run', '--experimental', '--cwd', root, '--', executable])
  expect(bypass.code).toBe(125)
  expect(bypass.stderr).toContain('Unknown option')
})

it('rejects missing grants rather than dropping the requested policy', async () => {
  const result = await run(['run', '--cwd', root, '--read', join(root, 'missing'), '--', spec().command.executable])
  expect(result.code).toBe(125)
  expect(result.stdout).toBe('')
  expect(result.stderr).toContain('ENOENT')
})

it.skipIf(!['darwin', 'win32'].includes(process.platform))(
  'terminates a long command when its lifetime expires',
  async () => {
    const command =
      process.platform === 'win32' ? [process.execPath, '-e', 'setTimeout(() => {}, 30000)'] : ['/bin/sleep', '30']
    const result = await run(['run', '--timeout-ms', '100', '--', ...command])
    expect(result.code).toBe(124)
    expect(JSON.parse(result.stderr).completion).toMatchObject({
      reason: 'limit',
      target: { status: 'exited' },
      cleanup: 'complete'
    })
  }
)

it.skipIf(!['darwin', 'win32'].includes(process.platform))(
  'preserves literal argv without shell interpolation',
  async () => {
    const marker = join(root, 'injected')
    const literal = `spaces ' quote; $(touch ${marker})`
    const literals = [literal, '', 'a"b', 'trailing\\', 'slash\\"quote', '& echo injected > ' + marker, '中文 路径']
    const command =
      process.platform === 'win32'
        ? [process.execPath, '-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', '--', ...literals]
        : ['/usr/bin/printf', '%s', literal]
    const result = await run(['run', '--', ...command])
    expect(result.code).toBe(0)
    expect(result.stdout).toBe(process.platform === 'win32' ? JSON.stringify(literals) : literal)
    expect(existsSync(marker)).toBe(false)
  }
)
