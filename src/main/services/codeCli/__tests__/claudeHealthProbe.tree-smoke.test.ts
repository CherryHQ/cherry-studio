import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { expect, it, vi } from 'vitest'
vi.mock('@application', () => ({ application: {} }))
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ debug: vi.fn(), warn: vi.fn() }) } }))
vi.mock('@main/core/platform', () => ({ isWin: process.platform === 'win32' }))
vi.mock('@main/utils/shellEnv', () => ({
  getRawShellEnv: async () => process.env,
  getShellEnv: async () => process.env
}))
const { probeClaudeExecutable } = await import('../claudeHealthProbe')
it.skipIf(process.platform === 'win32')(
  'reaps a real POSIX shim descendant before reporting timeout',
  async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'probe-tree-'))
    const shim = path.join(directory, 'claude')
    const receipt = path.join(directory, 'child.pid')
    let pid: number | undefined
    try {
      await writeFile(shim, '#!/bin/sh\nsleep 60 &\necho $! > child.pid\nwait\n')
      await chmod(shim, 0o700)
      const result = await probeClaudeExecutable(shim, directory)
      pid = Number(await readFile(receipt, 'utf8'))
      expect(result).toMatchObject({ ok: false, failure: { reason: 'timeout' } })
      // Linux may retain the killed orphan briefly as a zombie, which is not running.
      let running = true
      for (let i = 0; i < 50 && running; i++) {
        try {
          process.kill(pid, 0)
          if (process.platform === 'linux')
            running = !(await readFile(`/proc/${pid}/stat`, 'utf8')).split(' ')[2].includes('Z')
        } catch {
          running = false
        }
        if (running) await new Promise((resolve) => setTimeout(resolve, 100))
      }
      expect(running).toBe(false)
    } finally {
      if (pid) {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {}
      }
      await rm(directory, { recursive: true, force: true })
    }
  },
  20_000
)

it.skipIf(process.platform !== 'win32')(
  'reaps a real Windows cmd shim child before cleanup',
  async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'probe-tree-'))
    const shim = path.join(directory, 'claude.cmd')
    const receipt = path.join(directory, 'child.pid')
    let pid: number | undefined
    try {
      await writeFile(
        path.join(directory, 'worker.cjs'),
        "require('node:fs').writeFileSync('child.pid', String(process.pid)); setInterval(() => {}, 1000); setTimeout(() => process.exit(0), 60000);\n"
      )
      await writeFile(shim, `@echo off\r\n"${process.execPath}" worker.cjs\r\n`)
      const result = await probeClaudeExecutable(shim, directory)
      pid = Number(await readFile(receipt, 'utf8'))
      expect(Number.isInteger(pid) && pid > 0).toBe(true)
      expect(result).toMatchObject({ ok: false, failure: { reason: 'timeout' } })
      // This assertion is before finally's safety cleanup. Wrapper-only kill leaves this Node child alive.
      let running = true
      for (let i = 0; i < 50 && running; i++) {
        try {
          process.kill(pid, 0)
        } catch {
          running = false
        }
        if (running) await new Promise((resolve) => setTimeout(resolve, 100))
      }
      expect(running).toBe(false)
    } finally {
      if (!pid) {
        try {
          pid = Number(await readFile(receipt, 'utf8'))
        } catch {}
      }
      if (pid && Number.isInteger(pid) && pid > 0) {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {}
      }
      await rm(directory, { recursive: true, force: true })
    }
  },
  20_000
)
