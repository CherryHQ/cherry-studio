import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createConnection, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

import { SandboxManager } from '../src/host/SandboxManager.js'
import { readAll, spec } from './fixtures.js'

describe.skipIf(process.platform !== 'win32')('Windows native boundary', () => {
  it('allows granted access and preserves or restores host ACLs after stopping', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'sandbox-acl-')))
    const input = join(root, 'input')
    const marker = join(root, 'written')
    writeFileSync(input, 'granted content')
    const acl = async () => {
      const { stdout } = await promisify(execFile)(
        'pwsh.exe',
        ['-NoProfile', '-NonInteractive', '-Command', '(Get-Acl -LiteralPath $env:SANDBOX_ACL_TEST_PATH).Sddl'],
        { env: { ...process.env, SANDBOX_ACL_TEST_PATH: root }, encoding: 'utf8', timeout: 10000, windowsHide: true }
      )
      return stdout.trim()
    }
    const manager = new SandboxManager()
    try {
      const before = await acl()
      expect(before).not.toBe('')
      const request = spec(process.execPath, [
        '-e',
        `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(marker)},fs.readFileSync(${JSON.stringify(input)}));setInterval(()=>{},1000)`
      ])
      request.filesystem.write = [root]
      request.limits.lifetimeMs = 30000
      const instance = manager.start(request)
      const output = Promise.all([readAll(instance.stdout), readAll(instance.stderr)])
      await instance.ready
      await expect
        .poll(() => existsSync(marker) && readFileSync(marker, 'utf8'), { timeout: 5000 })
        .toBe('granted content')
      expect(await instance.stop()).toMatchObject({ cleanup: 'complete' })
      expect(await output).toEqual(['', ''])
      expect(await acl()).toBe(before)
    } finally {
      await manager.dispose()
      rmSync(root, { recursive: true, force: true })
    }
  }, 30000)

  it('rejects UNC, device paths and alternate streams before execution', async () => {
    const manager = new SandboxManager()
    try {
      for (const path of ['\\\\server\\share\\file', '\\\\?\\C:\\file', 'C:\\file:stream']) {
        const request = spec()
        request.filesystem.read = [path]
        const instance = manager.start(request)
        await expect(instance.ready).rejects.toMatchObject({ code: 'INVALID_SPEC' })
        expect((await instance.completion).target.status).toBe('not-started')
      }
    } finally {
      await manager.dispose()
    }
  })

  it('denies a reachable loopback service from the sandbox', async () => {
    const server = createServer((socket) => socket.end('reachable'))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing listener address')
    const control = await new Promise<string>((resolve, reject) => {
      const socket = createConnection(address.port, '127.0.0.1')
      let data = ''
      socket.on('data', (chunk) => (data += chunk))
      socket.on('end', () => resolve(data))
      socket.on('error', reject)
    })
    expect(control).toBe('reachable')
    const manager = new SandboxManager()
    try {
      const request = spec(process.execPath, [
        '-e',
        `const s=require('node:net').connect(${address.port},'127.0.0.1');s.on('connect',()=>{process.stdout.write('CONNECTED');s.destroy()});s.on('error',e=>process.stdout.write(e.code));s.setTimeout(1000,()=>{process.stdout.write('TIMEOUT');s.destroy()})`
      ])
      const instance = manager.start(request)
      const output = readAll(instance.stdout)
      const errors = readAll(instance.stderr)
      await instance.ready
      expect((await instance.completion).target).toMatchObject({ status: 'exited', exitCode: 0 })
      expect(await output).toMatch(/^(EACCES|EPERM|ETIMEDOUT|TIMEOUT)$/)
      expect(await errors).toBe('')
    } finally {
      await manager.dispose()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    }
  })

  it('stops a detached descendant before it can write its delayed marker', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'sandbox-tree-')))
    const marker = join(root, 'escaped')
    const pidFile = join(root, 'pid')
    const spawnError = join(root, 'spawn-error')
    const childCode = `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(pidFile + '.tmp')},String(process.pid));fs.renameSync(${JSON.stringify(pidFile + '.tmp')},${JSON.stringify(pidFile)});setTimeout(()=>fs.writeFileSync(${JSON.stringify(marker)},'escaped'),2500)`
    const request = spec(process.execPath, [
      '-e',
      `const c=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{detached:true,stdio:'ignore'});c.on('error',e=>{require('node:fs').writeFileSync(${JSON.stringify(spawnError)},String(e));process.exit(1)});setTimeout(()=>{},10000)`
    ])
    request.filesystem.write = [root]
    const manager = new SandboxManager()
    try {
      const instance = manager.start(request)
      const output = readAll(instance.stdout)
      const errors = readAll(instance.stderr)
      await instance.ready
      await expect
        .poll(
          () => {
            if (existsSync(spawnError)) return readFileSync(spawnError, 'utf8')
            return existsSync(pidFile) ? 'ready' : 'starting'
          },
          { timeout: 5000 }
        )
        .toBe('ready')
      const pid = Number(readFileSync(pidFile, 'utf8'))
      expect(Number.isSafeInteger(pid) && pid > 0).toBe(true)
      expect(() => process.kill(pid, 0)).not.toThrow()
      expect(await instance.stop()).toMatchObject({ cleanup: 'complete', target: { status: 'exited' } })
      await delay(2800)
      expect(existsSync(marker)).toBe(false)
      expect(() => process.kill(pid, 0)).toThrow()
      expect(await errors).toBe('')
      await output
    } finally {
      await manager.dispose()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
