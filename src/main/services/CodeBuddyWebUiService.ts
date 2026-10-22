import type { ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'

import { Mutex } from 'async-mutex'

import { application } from '@application'
import { resolveLocalAgentLaunch } from '@main/ai/runtime/localAgent/launch'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { crossPlatformSpawn, terminateProcessTree, waitForProcessExit } from '@main/utils/processRunner'
import type { LocalAgentConfiguration } from '@shared/ai/localAgent'
import type { CodeBuddyWebUiStatus } from '@shared/types/managedTool'

@Injectable('CodeBuddyWebUiService')
@ServicePhase(Phase.Background)
@DependsOn(['BinaryManager', 'LocalAgentInstallService'])
export class CodeBuddyWebUiService extends BaseService {
  private readonly mutex = new Mutex()
  private child?: ChildProcess
  private startup?: AbortController
  private isLifecycleStopping = false
  private stopRevision = 0
  private snapshot: CodeBuddyWebUiStatus = { status: 'stopped', owned: false }

  protected onInit() {
    this.isLifecycleStopping = false
    this.publish({ status: 'stopped', owned: false })
  }

  protected async onStop() {
    this.isLifecycleStopping = true
    await this.stop()
  }

  private publish(state: CodeBuddyWebUiStatus) {
    this.snapshot = state
    application.get('CacheService').setShared('feature.codebuddy.web_ui.status', state)
    return state
  }

  async getStatus(): Promise<CodeBuddyWebUiStatus> {
    return this.mutex.runExclusive(async () => {
      if (this.child) return this.snapshot
      const url = await this.discover()
      return this.publish({ status: url ? 'running' : 'stopped', owned: false, url })
    })
  }

  async start(config: LocalAgentConfiguration): Promise<CodeBuddyWebUiStatus> {
    if (config.presetId !== 'codebuddy-code') throw new Error('Unsupported Web UI agent')
    const revision = this.stopRevision
    return this.mutex.runExclusive(async () => {
      if (this.isLifecycleStopping) throw new Error('Application is shutting down')
      if (revision !== this.stopRevision) throw new Error('CodeBuddy Web UI startup was cancelled')
      if (this.child && this.snapshot.status === 'running') return this.snapshot
      if (this.child) await this.stopChild()
      const abort = new AbortController()
      this.startup = abort
      try {
        const existing = await this.discover()
        abort.signal.throwIfAborted()
        if (existing) return this.publish({ status: 'running', owned: false, url: existing })
        this.publish({ status: 'starting', owned: true })
        const launch = await resolveLocalAgentLaunch(config, abort.signal)
        const port = await availablePort()
        abort.signal.throwIfAborted()
        const password = randomBytes(24).toString('base64url')
        const url = `http://127.0.0.1:${port}/?password=${password}`
        const child = crossPlatformSpawn(
          launch.executable,
          [
            '--serve',
            '--host',
            '127.0.0.1',
            '--port',
            String(port),
            '--auth',
            'password',
            ...(config.nativeModel ? ['--model', config.nativeModel] : [])
          ],
          {
            env: { ...launch.env, CODEBUDDY_GATEWAY_PASSWORD: password },
            cwd: application.getPath('sys.home'),
            detached: process.platform !== 'win32',
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe']
          }
        )
        this.child = child
        const exited = () => {
          if (this.child !== child) return
          this.child = undefined
          abort.abort()
          this.publish({ status: 'stopped', owned: false })
        }
        child.once('exit', exited)
        child.once('error', exited)
        child.stdout?.resume()
        child.stderr?.resume()
        const deadline = Date.now() + 30_000
        while (Date.now() < deadline) {
          abort.signal.throwIfAborted()
          if (await isCodeBuddyWebUi(new URL(url).origin)) {
            abort.signal.throwIfAborted()
            return this.publish({ status: 'running', owned: true, url })
          }
          await delay(300, undefined, { signal: abort.signal })
        }
        throw new Error('CodeBuddy Web UI startup timed out')
      } catch (error) {
        try {
          await this.stopChild()
        } finally {
          this.publish({ status: 'error', owned: !!this.child })
        }
        throw error
      } finally {
        this.startup = undefined
      }
    })
  }

  async stop(): Promise<void> {
    this.stopRevision++
    this.startup?.abort()
    await this.mutex.runExclusive(async () => {
      if (!this.child && this.snapshot.status === 'running' && !this.snapshot.owned) return
      await this.stopChild()
      this.publish({ status: 'stopped', owned: false })
    })
  }

  private async stopChild() {
    const child = this.child
    if (!child) return
    await terminateProcessTree(child, false, 'CodeBuddy Web UI')
    if (!(await waitForProcessExit(child, 3000))) {
      await terminateProcessTree(child, true, 'CodeBuddy Web UI')
      if (!(await waitForProcessExit(child, 1000))) throw new Error('CodeBuddy Web UI did not stop')
    }
    if (this.child === child) this.child = undefined
  }

  private async discover(): Promise<string | undefined> {
    try {
      const record = JSON.parse(await readFile(application.getPath('external.codebuddy.web_ui_ports.file'), 'utf8'))
      const ports: unknown[] = Array.isArray(record?.ports) ? record.ports.slice(0, 4) : [record?.port]
      for (const port of ports) {
        if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) continue
        const url = `http://127.0.0.1:${port}/`
        if (await isCodeBuddyWebUi(url)) return url
      }
    } catch (error) {
      if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    return undefined
  }
}

async function isCodeBuddyWebUi(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1000), redirect: 'error' })
    return response.ok && /<title>CodeBuddy\b/i.test(await response.text())
  } catch {
    return false
  }
}

async function availablePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  if (!address || typeof address === 'string') throw new Error('Cannot allocate Web UI port')
  return address.port
}
