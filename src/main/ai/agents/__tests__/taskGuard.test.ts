import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { evaluateTaskGuard } from '../taskGuard'

describe('evaluateTaskGuard', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'task-guard-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('always proceeds for the always guard', async () => {
    expect(await evaluateTaskGuard({ type: 'always' }, { lastRunStartedAt: null })).toEqual({ proceed: true })
  })

  describe('file_changed', () => {
    it('skips when the file is missing', async () => {
      const path = join(dir, 'missing.txt')
      const outcome = await evaluateTaskGuard({ type: 'file_changed', path }, { lastRunStartedAt: null })
      expect(outcome).toEqual({ proceed: false, reason: `file missing: ${path}` })
    })

    it('proceeds on the first run when the file exists', async () => {
      const path = join(dir, 'a.txt')
      await writeFile(path, 'x')
      expect(await evaluateTaskGuard({ type: 'file_changed', path }, { lastRunStartedAt: null })).toEqual({
        proceed: true
      })
    })

    it('skips when the file is not newer than the last run, proceeds when it is', async () => {
      const path = join(dir, 'a.txt')
      await writeFile(path, 'x')
      const modified = new Date('2026-01-01T00:00:00Z')
      await utimes(path, modified, modified)

      const unchanged = await evaluateTaskGuard(
        { type: 'file_changed', path },
        { lastRunStartedAt: modified.getTime() + 1000 }
      )
      expect(unchanged).toEqual({ proceed: false, reason: `unchanged: ${path}` })

      const changed = await evaluateTaskGuard(
        { type: 'file_changed', path },
        { lastRunStartedAt: modified.getTime() - 1000 }
      )
      expect(changed).toEqual({ proceed: true })
    })
  })

  describe('command', () => {
    it('proceeds on exit 0 and skips with the exit code otherwise', async () => {
      const node = `"${process.execPath}"`
      expect(
        await evaluateTaskGuard(
          { type: 'command', command: `${node} -e "process.exit(0)"` },
          { lastRunStartedAt: null }
        )
      ).toEqual({ proceed: true })

      const failed = await evaluateTaskGuard(
        { type: 'command', command: `${node} -e "process.exit(3)"` },
        { lastRunStartedAt: null }
      )
      expect(failed).toMatchObject({ proceed: false })
      expect(failed.proceed === false && failed.reason).toContain('exit code 3')
    })

    it('proceeds for a successful command whose unused output exceeds the pipe buffer', async () => {
      // Regression: exec buffered stdout/stderr at a 1 MiB default maxBuffer, so
      // an exit-0 command emitting more than that was rejected with
      // "stdout maxBuffer length exceeded". The contract is exit-code-only.
      const node = `"${process.execPath}"`
      const bigOutput = `${node} -e "process.stdout.write('x'.repeat(2 * 1024 * 1024)); process.stderr.write('y'.repeat(2 * 1024 * 1024))"`
      expect(await evaluateTaskGuard({ type: 'command', command: bigOutput }, { lastRunStartedAt: null })).toEqual({
        proceed: true
      })
    })

    it('keeps the exit code as the predicate when large output is discarded', async () => {
      const node = `"${process.execPath}"`
      const bigOutput = `${node} -e "process.stdout.write('x'.repeat(2 * 1024 * 1024)); process.exit(3)"`
      const outcome = await evaluateTaskGuard({ type: 'command', command: bigOutput }, { lastRunStartedAt: null })
      expect(outcome).toMatchObject({ proceed: false })
      expect(outcome.proceed === false && outcome.reason).toContain('exit code 3')
    })

    it('rejects on cancellation instead of resolving a guard skip', async () => {
      const node = `"${process.execPath}"`
      const controller = new AbortController()
      const reason = new Error('cancelled by test')
      const promise = evaluateTaskGuard(
        { type: 'command', command: `${node} -e "setTimeout(() => {}, 10000)"` },
        { lastRunStartedAt: null, signal: controller.signal }
      )
      setTimeout(() => controller.abort(reason), 20)
      await expect(promise).rejects.toBe(reason)
    })
  })
})
