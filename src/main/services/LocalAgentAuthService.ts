import { shell } from 'electron'

import { application } from '@application'
import { runCliLogin } from '@cherrystudio/agent-runtime/stdio'
import { authenticateCursor } from '@main/ai/runtime/cursor/cursorAccount'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { getLocalAgentProtocol, type LocalAgentConfiguration } from '@shared/ai/localAgent'
import { isSensitiveKey, redactLiteral } from '@shared/utils/redaction'

import { authenticateLocalAcp } from '../ai/runtime/acp/AcpManagement'
import { spawnLocalAgentStdio } from '../ai/runtime/stdioProcess'
import { type CliAuthCommandSpec, type CliAuthOptions, resolveCliAuthCommand, resolveLocalAgentCli } from './codeCli'

const AUTH_TIMEOUT_MS = 300_000

function redactAuthMessage(message: string, config: LocalAgentConfiguration, secret?: string): string {
  let sanitized = message
  if (secret) sanitized = redactLiteral(sanitized, secret)
  for (const [key, value] of Object.entries(config.env)) {
    if (isSensitiveKey(key)) sanitized = redactLiteral(sanitized, value)
  }
  return sanitized
}

@Injectable('LocalAgentAuthService')
@ServicePhase(Phase.Background)
@DependsOn(['BinaryManager'])
export class LocalAgentAuthService extends BaseService {
  private readonly pending = new Map<string, () => Promise<void>>()

  async authenticate(
    requestId: string,
    config: LocalAgentConfiguration,
    methodId: string,
    options?: CliAuthOptions
  ): Promise<void> {
    if (this.pending.has(requestId)) throw new Error('Authentication is already in progress')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('Authentication timed out')), AUTH_TIMEOUT_MS)
    const work = this.run(requestId, config, methodId, controller.signal, options)
    this.pending.set(requestId, async () => {
      controller.abort(new Error('Authentication cancelled'))
      await work.catch(() => {})
    })
    try {
      await work
    } catch (error) {
      const cause = controller.signal.aborted ? controller.signal.reason : error
      throw new Error(
        redactAuthMessage(cause instanceof Error ? cause.message : String(cause), config, options?.secret)
      )
    } finally {
      clearTimeout(timer)
      this.pending.delete(requestId)
    }
  }

  private async run(
    requestId: string,
    config: LocalAgentConfiguration,
    methodId: string,
    signal: AbortSignal,
    options?: CliAuthOptions
  ) {
    const protocol = getLocalAgentProtocol(config.presetId)
    if (protocol === 'cursor') return authenticateCursor(methodId, signal)
    const spec = resolveCliAuthCommand(config.presetId, methodId, options)
    if (spec) return this.authenticateViaCli(requestId, config, spec, signal)
    if (protocol !== 'acp') throw new Error('ACP authentication is unavailable')
    return authenticateLocalAcp(config, application.getPath('cherry.bin'), methodId, signal)
  }

  private async authenticateViaCli(
    requestId: string,
    config: LocalAgentConfiguration,
    spec: CliAuthCommandSpec,
    signal: AbortSignal
  ) {
    const launch = await resolveLocalAgentCli(config, signal)
    let openedUrl: string | undefined
    await runCliLogin(
      { ...launch, args: spec.args, cwd: process.cwd() },
      spawnLocalAgentStdio,
      signal,
      spec.stdin,
      ({ url, code }) => {
        application.get('IpcApiService').broadcast('ai.local_agents.auth_prompt', {
          requestId,
          ...(url ? { url } : {}),
          ...(code ? { code } : {})
        })
        if (spec.autoOpenUrl && url && url !== openedUrl && (url.startsWith('https://') || url.startsWith('http://'))) {
          openedUrl = url
          void shell.openExternal(url).catch(() => undefined)
        }
      }
    )
  }

  async cancel(requestId: string): Promise<void> {
    await this.pending.get(requestId)?.()
  }

  protected async onStop() {
    try {
      await Promise.all([...this.pending.values()].map((stop) => stop()))
    } finally {
      this.pending.clear()
    }
  }
}
