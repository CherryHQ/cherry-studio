import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { createConnection, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { describe, expect, it } from 'vitest'

import { SandboxManager } from '../src/host/SandboxManager.js'
import { readAll, spec } from './fixtures.js'

describe.skipIf(process.platform !== 'win32')('Windows native boundary', () => {
  it('restores grant ACL entries after stopping the instance', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'sandbox-acl-')))
    const acl = () =>
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '([IO.Directory]::GetAccessControl($env:SANDBOX_ACL_TEST_PATH)).Access | Select-Object IdentityReference,FileSystemRights,AccessControlType,IsInherited,InheritanceFlags,PropagationFlags | Sort-Object IdentityReference,FileSystemRights | ConvertTo-Json -Compress'
        ],
        { env: { ...process.env, SANDBOX_ACL_TEST_PATH: root }, encoding: 'utf8', timeout: 5000, windowsHide: true }
      ).trim()
    const before = acl()
    const manager = new SandboxManager()
    try {
      const request = spec(process.execPath, ['-e', 'setTimeout(()=>{},20000)'])
      request.filesystem.write = [root]
      const instance = manager.start(request)
      await instance.ready
      expect(acl()).not.toBe(before)
      expect(await instance.stop()).toMatchObject({ cleanup: 'complete' })
      expect(acl()).toBe(before)
    } finally {
      await manager.dispose()
      rmSync(root, { recursive: true, force: true })
    }
  })

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
    const childCode = `setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(marker)},'escaped'),2500)`
    const request = spec(process.execPath, [
      '-e',
      `const c=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{detached:true,stdio:'ignore'});c.on('error',e=>{console.error(e);process.exit(1)});require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(c.pid));setTimeout(()=>{},10000)`
    ])
    request.filesystem.write = [root]
    const manager = new SandboxManager()
    try {
      const instance = manager.start(request)
      const output = readAll(instance.stdout)
      const errors = readAll(instance.stderr)
      await instance.ready
      for (let attempts = 0; attempts < 50 && !existsSync(pidFile); attempts++) await delay(20)
      expect(existsSync(pidFile)).toBe(true)
      const pid = Number(readFileSync(pidFile, 'utf8'))
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
