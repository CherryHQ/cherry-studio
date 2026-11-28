import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { afterEach, expect, it, vi } from 'vitest'

import { application } from '@application'
import type { SandboxSpec } from '@cherrystudio/sandbox/types'
import { BaseService } from '@main/core/lifecycle'
import { sandboxRequestSchemas } from '@shared/ipc/schemas/sandbox'

import { SandboxService } from '../SandboxService'

const { launch } = vi.hoisted(() => ({ launch: vi.fn() }))
vi.mock('@cherrystudio/sandbox', () => ({
  SandboxManager: class {
    start = launch
  }
}))

afterEach(() => {
  vi.restoreAllMocks()
  launch.mockReset()
  BaseService.resetInstances()
})

it('executes maximum-size source from a workspace file and removes it after completion', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sandbox-service-'))
  vi.mocked(application.getPath).mockImplementation((key) => {
    if (key === 'feature.sandbox.temp') return root
    if (key === 'app.exe_file') return process.execPath
    throw new Error(`Unexpected path: ${key}`)
  })
  const body = 'process.stdout.write(JSON.stringify({value:42,commonjs:typeof require}))\n//'
  const code = body + '"'.repeat(32768 - body.length)
  const input = sandboxRequestSchemas['sandbox.run'].input.parse({ code, timeoutMs: 10000 })
  let script = ''
  launch.mockImplementation((spec: SandboxSpec) => {
    expect(spec.command.args).not.toContain('-e')
    expect(spec.command.args.join(' ').length).toBeLessThan(1024)
    script = spec.command.args.at(-1)!
    expect(readFileSync(script, 'utf8')).toBe(code)
    expect(path.dirname(script)).toBe(spec.command.cwd)
    const result = promisify(execFile)(process.execPath, [...spec.command.args], {
      cwd: spec.command.cwd,
      timeout: 10000
    })
    return {
      ready: Promise.resolve(),
      completion: result.then(() => ({ tree: 'unverified', cleanup: 'complete' })),
      stdout: {
        async *[Symbol.asyncIterator]() {
          yield Buffer.from((await result).stdout)
        }
      },
      stderr: {
        async *[Symbol.asyncIterator]() {
          yield Buffer.from((await result).stderr)
        }
      }
    }
  })
  try {
    const service = new SandboxService()
    const result = await service['execute'](input, 'window', new AbortController().signal)
    expect(result.stdout).toBe('{"value":42,"commonjs":"function"}')
    expect(result.stderr).toBe('')
    expect(script).not.toBe('')
    expect(existsSync(script)).toBe(false)
    expect(await readdir(root)).toEqual([])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
