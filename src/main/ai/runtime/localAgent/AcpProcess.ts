import type { ChildProcess } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'

import { app } from 'electron'

import { application } from '@application'
import type { AcpClient } from '@cherrystudio/agent-runtime-acp/v1'
import { loggerService } from '@logger'
import { crossPlatformSpawn } from '@main/utils/processRunner'
import type { LocalAgentConfiguration } from '@shared/ai/localAgent'

import type { resolveLocalAgentLaunch } from './launch'
import { stopLocalAgentProcess } from './localAgentProcess'

const logger = loggerService.withContext('AcpProcess')
type ClientLifetime = Pick<AcpClient, 'signal' | 'close'>
type Launch = Awaited<ReturnType<typeof resolveLocalAgentLaunch>>

export class AcpProcess {
  private child?: ChildProcess
  private client?: ClientLifetime
  private gateway?: { dispose(): Promise<void> }
  private releasing?: Promise<void>
  private closing?: Promise<void>
  stderr = ''

  async open<T extends ClientLifetime>(
    config: LocalAgentConfiguration,
    launch: Launch,
    cwd: string,
    signal: AbortSignal,
    attach: (stdin: Writable, stdout: Readable, info: { name: string; version: string }) => T,
    exited?: (error: Error) => void
  ) {
    signal.throwIfAborted()
    if (
      config.presetId === 'openclaw' &&
      !config.env.OPENCLAW_STATE_DIR &&
      !config.env.OPENCLAW_CONFIG_PATH &&
      !config.env.OPENCLAW_GATEWAY_URL &&
      !launch.args.some((arg) => arg === '--url' || arg.startsWith('--url='))
    ) {
      const lease = await application.get('OpenClawService').acquireGateway(signal)
      if (signal.aborted) {
        await lease.dispose()
        signal.throwIfAborted()
      }
      this.gateway = lease
      launch.env.OPENCLAW_GATEWAY_URL = lease.url
      if (lease.token) launch.env.OPENCLAW_GATEWAY_TOKEN = lease.token
    }
    const child = crossPlatformSpawn(launch.executable, launch.args, {
      cwd,
      env: launch.env,
      detached: process.platform !== 'win32'
    })
    this.child = child
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-4000)
    })
    const disconnected = (error: Error) => {
      this.client?.close(error)
      exited?.(error)
    }
    child.once('error', disconnected)
    child.once('exit', () => {
      disconnected(new Error('Local agent process exited'))
      void this.releaseGateway()?.catch((error) => logger.warn('Failed to release OpenClaw Gateway', { error }))
    })
    if (!child.stdin || !child.stdout) throw new Error('Local agent stdio is unavailable')
    const client = attach(child.stdin, child.stdout, { name: 'cherry-studio', version: app.getVersion() })
    this.client = client
    return client
  }

  close(closeSession?: () => Promise<unknown>): Promise<void> {
    return (this.closing ??= this.stop(closeSession))
  }

  private async stop(closeSession?: () => Promise<unknown>) {
    if (closeSession && this.client && !this.client.signal.aborted) {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          closeSession(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('ACP session close timed out')), 2000)
          })
        ])
      } catch (error) {
        logger.warn('ACP session close failed; terminating owned process', { error })
      } finally {
        clearTimeout(timer)
      }
    }
    this.client?.close()
    try {
      await stopLocalAgentProcess(this.child)
    } finally {
      await this.releaseGateway()
    }
  }

  private releaseGateway() {
    if (this.gateway) {
      this.releasing = this.gateway.dispose()
      this.gateway = undefined
    }
    return this.releasing
  }
}
