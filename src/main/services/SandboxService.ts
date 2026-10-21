import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { app } from 'electron'

import { application } from '@application'
import { SandboxManager } from '@cherrystudio/sandbox'
import type { SandboxSpec } from '@cherrystudio/sandbox/types'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { InputFor, OutputFor } from '@shared/ipc/types'

const logger = loggerService.withContext('SandboxService')

@Injectable('SandboxService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['WindowManager'])
export class SandboxService extends BaseService {
  private manager = new SandboxManager()
  private runs = new Map<string, { controller: AbortController; done: Promise<OutputFor<'sandbox.run'>> }>()

  protected async onInit() {
    // FFI loads need a real filesystem path, outside Electron's ASAR virtual filesystem.
    if (app.isPackaged) process.env.MXC_FFI_DIR = application.getPath('feature.sandbox.native.builtin')
    this.manager = new SandboxManager()
  }

  protected async onStop() {
    for (const run of this.runs.values()) run.controller.abort()
    await Promise.allSettled([...this.runs.values()].map((run) => run.done))
    const completions = await this.manager.dispose()
    for (const completion of completions) {
      if (completion.cleanup !== 'complete') logger.error('Sandbox cleanup incomplete', { completion })
    }
  }

  async probe(): Promise<OutputFor<'sandbox.probe'>> {
    const spec = await this.createSpec('probe', application.getPath('feature.sandbox.temp'), ['-e', ''], 1000)
    const assessment = await this.manager.probe(spec)
    return {
      status: assessment.status,
      report: JSON.stringify({ versions: process.versions, ...assessment }, null, 2)
    }
  }

  async run(input: InputFor<'sandbox.run'>, senderId: string | null): Promise<OutputFor<'sandbox.run'>> {
    if (!this.isReady) throw new Error('Sandbox service is not ready')
    const window = senderId ? application.get('WindowManager').getWindow(senderId) : undefined
    if (!senderId || !window || window.isDestroyed()) throw new Error('Sandbox requires a managed window')
    if (this.runs.has(senderId) || this.runs.size >= 4) throw new Error('Sandbox is busy')
    const controller = new AbortController()
    const stop = () => controller.abort()
    window.webContents.once('destroyed', stop)
    const done = this.execute(input, senderId, controller.signal)
    this.runs.set(senderId, { controller, done })
    try {
      return await done
    } finally {
      window.webContents.removeListener('destroyed', stop)
      this.runs.delete(senderId)
    }
  }

  async stopRun(senderId: string | null): Promise<void> {
    if (senderId) {
      const run = this.runs.get(senderId)
      run?.controller.abort()
      await run?.done
    }
  }

  private async execute(input: InputFor<'sandbox.run'>, ownerId: string, signal: AbortSignal) {
    const cwd = await mkdtemp(path.join(application.getPath('feature.sandbox.temp'), 'run-'))
    let removable = true
    try {
      const script = path.join(cwd, 'script.cjs')
      await writeFile(script, input.code, { encoding: 'utf8', mode: 0o600 })
      const spec = await this.createSpec(ownerId, cwd, ['--preserve-symlinks-main', script], input.timeoutMs)
      const instance = this.manager.start(spec, { signal })
      removable = false
      // Drain immediately: waiting for readiness first can deadlock a noisy guest.
      const stdout = collectOutput(instance.stdout)
      const stderr = collectOutput(instance.stderr)
      const readiness = instance.ready.then(() => null, String)
      const completion = await instance.completion
      removable = completion.tree !== 'unknown' && completion.cleanup === 'complete'
      const [out, err, startupError] = await Promise.all([stdout, stderr, readiness])
      return {
        stdout: out,
        stderr: err,
        report: JSON.stringify({ ...completion, startupError }, null, 2)
      }
    } finally {
      if (removable) await rm(cwd, { recursive: true, force: true })
      else logger.warn('Retaining sandbox workspace after incomplete cleanup', { cwd })
    }
  }

  private async createSpec(ownerId: string, cwd: string, args: string[], lifetimeMs: number) {
    const executable = application.getPath('app.exe_file')
    const runtimeDir = path.dirname(executable)
    const read =
      process.platform === 'win32'
        ? (await readdir(runtimeDir, { withFileTypes: true }))
            .filter((entry) => entry.isFile() && /\.(dll|bin|dat)$/i.test(entry.name))
            .map((entry) => path.join(runtimeDir, entry.name))
        : [path.dirname(runtimeDir)]
    return {
      ownerId,
      environmentId: 'native',
      runtimeProfileId: 'mxc-command-v1',
      command: { executable, args, cwd, env: { ELECTRON_RUN_AS_NODE: '1', TEMP: cwd, TMP: cwd } },
      filesystem: { read, write: [cwd], denyRead: [], denyWrite: [] },
      network: { mode: 'deny' },
      channel: 'none',
      limits: {
        startupTimeoutMs: 15000,
        lifetimeMs,
        stopGraceMs: 100,
        stopTimeoutMs: 5000,
        cleanupTimeoutMs: 5000,
        ioDrainTimeoutMs: 1000,
        ioBufferBytes: 65536,
        outputBytes: 65536
      }
    } satisfies SandboxSpec & { channel: 'none' }
  }
}

async function collectOutput(stream: AsyncIterable<Uint8Array>): Promise<string> {
  const chunks: Buffer[] = []
  let remaining = 65536
  for await (const chunk of stream) {
    const part = Buffer.from(chunk.subarray(0, remaining))
    chunks.push(part)
    remaining -= part.length
  }
  return Buffer.concat(chunks).toString('utf8')
}
