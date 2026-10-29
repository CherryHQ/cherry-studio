import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises'
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

    it('skips irreversibly when the deadline passes even if the command then exits 0 on SIGTERM', async () => {
      // Real shell: traps SIGTERM and exits 0 (a well-behaved command that
      // shuts down cleanly on our kill). The timeout outcome must still be a
      // skip, never a late approval.
      const marker = join(dir, 'sigterm-received')
      // The trap lives in the spawned shell itself (no nested sh -c), so the
      // kill reaches the process that owns the trap.
      // Background sleep + wait: sh defers traps while waiting on a
      // foreground child, but a trapped signal interrupts `wait` itself.
      const command = `trap "touch ${marker}; exit 0" TERM; sleep 60 & wait`
      const started = Date.now()
      const outcome = await evaluateTaskGuard({ type: 'command', command }, { lastRunStartedAt: null })
      const elapsed = Date.now() - started

      expect(outcome).toEqual({ proceed: false, reason: `command failed (timed out): ${command}` })
      expect(elapsed).toBeGreaterThanOrEqual(30_000)
      expect(elapsed).toBeLessThan(40_000)
      // The SIGTERM was really delivered (the trap ran) and the exit-0 from
      // it did not flip the already-settled skip. The touch lands right
      // after the kill, so give the trap a moment to run.
      await new Promise((resolve) => setTimeout(resolve, 500))
      await expect(stat(marker)).resolves.toBeTruthy()
    }, 45_000)

    it('settles the skip in bounded time and terminates the owned shell when SIGTERM is ignored', async () => {
      // Real shell: ignores SIGTERM entirely, so settlement cannot rely on
      // process exit. A unique marker argument lets us verify the owned
      // shell is actually reaped after SIGKILL escalation. (A descendant the
      // command spawned may outlive this - tracked separately.)
      const marker = `guard-ignore-${Date.now()}-${Math.random().toString(36).slice(2)}`
      // The trap lives in the spawned shell itself; the marker sits in its
      // own command line so we can watch that exact process in ps.
      const command = `trap "" TERM; : "${marker}"; sleep 60`
      const findOwnedShell = () =>
        spawnSync('ps', ['-eo', 'args='])
          .stdout.toString()
          .split('\n')
          .some((line) => line.includes(marker))

      const started = Date.now()
      const outcome = await evaluateTaskGuard({ type: 'command', command }, { lastRunStartedAt: null })
      const elapsed = Date.now() - started

      expect(outcome).toEqual({ proceed: false, reason: `command failed (timed out): ${command}` })
      expect(elapsed).toBeGreaterThanOrEqual(30_000)
      expect(elapsed).toBeLessThan(40_000)
      expect(findOwnedShell()).toBe(true) // SIGTERM was ignored: still alive right after the skip
      await new Promise((resolve) => setTimeout(resolve, 6_000)) // past the 5s SIGKILL grace
      expect(findOwnedShell()).toBe(false)
    }, 45_000)

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
