import type { ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import { createInterface } from 'node:readline'
import { setTimeout as delay } from 'node:timers/promises'

import { Mutex } from 'async-mutex'

import { application } from '@application'
import { resolveLocalAgentLaunch } from '@main/ai/runtime/localAgent/launch'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { crossPlatformSpawn, terminateProcessTree, waitForProcessExit } from '@main/utils/processRunner'
import type { LocalAgentConfiguration } from '@shared/ai/localAgent'
import { LOCAL_AGENT_WEB_UI_IDS, type LocalAgentWebUiId, type ManagedToolStatusState } from '@shared/types/managedTool'

interface WebUiProcess {
  mutex: Mutex
  revision: number
  child?: ChildProcess
  startup?: AbortController
  status: ManagedToolStatusState
}

@Injectable('LocalAgentWebUiService')
@ServicePhase(Phase.Background)
@DependsOn(['BinaryManager', 'LocalAgentInstallService'])
export class LocalAgentWebUiService extends BaseService {
  private readonly processes = new Map<LocalAgentWebUiId, WebUiProcess>()
  private closing = false

  protected async onStop() {
    this.closing = true
    await Promise.all([...this.processes.keys()].map((id) => this.stop(id)))
  }

  private publish(entry: WebUiProcess, status: ManagedToolStatusState) {
    entry.status = status
    application
      .get('CacheService')
      .setShared(
        'feature.local_agent.web_ui.status',
        Object.fromEntries([...this.processes].map(([id, process]) => [id, process.status]))
      )
    return status
  }

  async start(config: LocalAgentConfiguration): Promise<ManagedToolStatusState> {
    const id = LOCAL_AGENT_WEB_UI_IDS.find((id) => id === config.presetId)
    if (!id) throw new Error('Unsupported Web UI agent')
    let entry = this.processes.get(id)
    if (!entry) {
      entry = { mutex: new Mutex(), revision: 0, status: { status: 'stopped' } }
      this.processes.set(id, entry)
    }
    const instance = entry
    const revision = instance.revision
    return instance.mutex.runExclusive(async () => {
      if (this.closing || revision !== instance.revision) throw new Error('Web UI startup cancelled')
      if (instance.child && instance.status.status === 'running') return instance.status
      const abort = new AbortController()
      instance.startup = abort
      this.publish(instance, { status: 'starting' })
      try {
        await this.stopChild(instance)
        const launch = await resolveLocalAgentLaunch(config, abort.signal)
        const port = await availablePort()
        abort.signal.throwIfAborted()
        const url = new URL(`http://127.0.0.1:${port}/`)
        if (id === 'kilo') url.pathname = '/console'
        const env = { ...launch.env }
        const args =
          id === 'kimi'
            ? ['web', '--host', '127.0.0.1', '--port', String(port), '--no-open']
            : ['serve', '--hostname', '127.0.0.1', '--port', String(port)]
        if (id === 'qwen') {
          env.QWEN_SERVER_TOKEN = randomBytes(24).toString('base64url')
          url.hash = `token=${env.QWEN_SERVER_TOKEN}`
        }
        const child = crossPlatformSpawn(launch.executable, args, {
          env,
          cwd: application.getPath('sys.home'),
          detached: process.platform !== 'win32',
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe']
        })
        instance.child = child
        const exited = () => {
          if (instance.child !== child) return
          instance.child = undefined
          abort.abort()
          this.publish(instance, { status: 'stopped' })
        }
        child.once('exit', exited)
        child.once('error', exited)
        if (id === 'kimi' && child.stdout) {
          createInterface({ input: child.stdout }).on('line', (line) => {
            const address = line.match(/http:\/\/127\.0\.0\.1:\d+\/#token=[a-zA-Z0-9._~%+-]+/)?.[0]
            if (address) url.href = address
          })
        } else child.stdout?.resume()
        child.stderr?.resume()
        const deadline = Date.now() + 30_000
        while (Date.now() < deadline) {
          abort.signal.throwIfAborted()
          const response = await fetch(url, {
            signal: AbortSignal.any([abort.signal, AbortSignal.timeout(1000)]),
            redirect: 'error'
          }).catch(() => undefined)
          if (response?.ok && response.headers.get('content-type')?.includes('text/html')) {
            await response.body?.cancel()
            if (id === 'kimi' && !url.hash) {
              await delay(100, undefined, { signal: abort.signal })
              continue
            }
            abort.signal.throwIfAborted()
            return this.publish(instance, { status: 'running', url: url.toString() })
          }
          await response?.body?.cancel()
          await delay(300, undefined, { signal: abort.signal })
        }
        throw new Error('Web UI startup timed out')
      } catch (error) {
        await this.stopChild(instance)
        this.publish(instance, { status: 'error' })
        throw error
      } finally {
        instance.startup = undefined
      }
    })
  }

  async stop(id: LocalAgentWebUiId): Promise<void> {
    const entry = this.processes.get(id)
    if (!entry) return
    entry.revision++
    entry.startup?.abort()
    await entry.mutex.runExclusive(async () => {
      await this.stopChild(entry)
      this.publish(entry, { status: 'stopped' })
    })
  }

  private async stopChild(entry: WebUiProcess) {
    const child = entry.child
    if (!child) return
    await terminateProcessTree(child, false, 'Agent Web UI')
    if (!(await waitForProcessExit(child, 3000))) {
      await terminateProcessTree(child, true, 'Agent Web UI')
      if (!(await waitForProcessExit(child, 1000))) throw new Error('Web UI did not stop')
    }
    if (entry.child === child) entry.child = undefined
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
