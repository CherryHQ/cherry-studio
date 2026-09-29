import { application } from '@application'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { LocalAgentConfiguration } from '@shared/ai/localAgent'
import { isSensitiveKey, redactLiteral } from '@shared/utils/redaction'

import { AcpConnection } from './AcpConnection'

@Injectable('LocalAgentAuthService')
@ServicePhase(Phase.Background)
@DependsOn(['BinaryManager'])
export class LocalAgentAuthService extends BaseService {
  private readonly pending = new Map<string, AcpConnection>()

  async authenticate(requestId: string, config: LocalAgentConfiguration, methodId: string): Promise<void> {
    if (config.protocol !== 'acp') throw new Error('ACP authentication is unavailable')
    if (this.pending.has(requestId)) throw new Error('Authentication is already in progress')
    const live = new AcpConnection(`local-agent-auth:${requestId}`, '', config)
    this.pending.set(requestId, live)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        (async () => {
          await live.start(application.getPath('cherry.bin'), undefined, true)
          await live.authenticate(methodId)
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Authentication timed out')), 300000)
        })
      ])
    } catch (error) {
      let message = error instanceof Error ? error.message : String(error)
      for (const [key, value] of Object.entries(config.env)) {
        if (isSensitiveKey(key)) message = redactLiteral(message, value)
      }
      throw new Error(message)
    } finally {
      clearTimeout(timer)
      await live.close()
      this.pending.delete(requestId)
    }
  }

  async cancel(requestId: string): Promise<void> {
    await this.pending.get(requestId)?.close()
  }

  protected async onStop() {
    await Promise.all([...this.pending.values()].map((live) => live.close()))
    this.pending.clear()
  }
}
