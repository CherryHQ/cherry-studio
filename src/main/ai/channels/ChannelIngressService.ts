import { application } from '@application'
import {
  BaseService,
  DependsOn,
  type Disposable,
  Injectable,
  Phase,
  SERVICE_STOP_TIMEOUT_MS,
  ServicePhase
} from '@main/core/lifecycle'

const CHANNEL_INGRESS_DRAIN_TIMEOUT_MS = SERVICE_STOP_TIMEOUT_MS - 500

@Injectable('ChannelIngressService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['ChannelManager', 'AiService', 'AgentConnectionManager'])
export class ChannelIngressService extends BaseService {
  private shutdownHold?: Disposable

  protected async onReady(): Promise<void> {
    await application.get('ChannelManager').start()
    this.shutdownHold?.dispose()
    this.shutdownHold = undefined
  }

  protected async onStop(): Promise<void> {
    const channelManager = application.get('ChannelManager')
    this.shutdownHold ??= channelManager.pause('application-shutdown')
    await channelManager.drainInFlight({ timeoutMs: CHANNEL_INGRESS_DRAIN_TIMEOUT_MS })
  }
}
