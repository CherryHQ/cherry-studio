import type { Readable, Writable } from 'node:stream'

import { app } from 'electron'

import { launchAcpStdio, type AcpClient } from '@cherrystudio/agent-runtime-acp/v1'
import { loggerService } from '@logger'
import type { LocalAgentConfiguration } from '@shared/ai/localAgent'

import { spawnLocalAgentStdio } from '../stdioProcess'
import type { resolveAcpLaunch } from './acpLaunch'
import { acpPreset } from './acpPresets'

const logger = loggerService.withContext('AcpProcess')
type ClientLifetime = Pick<AcpClient, 'signal' | 'close'>
type Launch = Omit<Awaited<ReturnType<typeof resolveAcpLaunch>>, 'modelBinding'>

export class AcpProcess {
  private connection?: ReturnType<typeof launchAcpStdio>
  private gateway?: { dispose(): Promise<void> }
  private releasing?: Promise<void>
  private closing?: Promise<void>
  get stderr() {
    return this.connection?.stderr ?? ''
  }

  async open<T extends ClientLifetime>(
    config: LocalAgentConfiguration,
    launch: Launch,
    cwd: string,
    signal: AbortSignal,
    attach: (stdin: Writable, stdout: Readable, info: { name: string; version: string }) => T,
    exited?: (error: Error) => void
  ) {
    signal.throwIfAborted()
    const acquireGateway = acpPreset(config.presetId)?.acquireGateway
    if (acquireGateway) {
      const lease = await acquireGateway(config.env, launch, signal)
      if (signal.aborted) {
        await lease?.dispose()
        signal.throwIfAborted()
      }
      this.gateway = lease
    }
    const connection = launchAcpStdio(
      { executable: launch.executable, args: launch.args, cwd, env: launch.env },
      spawnLocalAgentStdio,
      ({ stdin, stdout }) => attach(stdin, stdout, { name: 'cherry-studio', version: app.getVersion() }),
      (error) => {
        try {
          exited?.(error)
        } finally {
          void this.releaseGateway()?.catch((error) =>
            logger.warn('Failed to release the ACP process lease', { error })
          )
        }
      }
    )
    this.connection = connection
    return connection.client
  }

  close(closeSession?: () => Promise<unknown>): Promise<void> {
    return (this.closing ??= this.stop(closeSession).catch((error: unknown) => {
      this.closing = undefined
      throw error
    }))
  }

  private async stop(closeSession?: () => Promise<unknown>) {
    try {
      await this.connection?.close(closeSession, (error) =>
        logger.warn('ACP session close failed; terminating owned process', { error })
      )
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
