import { application } from '@application'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

import { checkVpnNetworks } from './vpnStatus'

@Injectable('DeviceConnectionSetupService')
@ServicePhase(Phase.WhenReady)
export class DeviceConnectionSetupService extends BaseService {
  private setupAbort = new AbortController()
  private networkCheck?: ReturnType<typeof checkVpnNetworks>
  private install?: Promise<{ outcome: 'installed' | 'existing' | 'manual-required' }>

  protected onInit(): void {
    this.setupAbort = new AbortController()
    this.registerDisposable(() => this.setupAbort.abort())
  }

  checkNetworks() {
    this.setupAbort.signal.throwIfAborted()
    this.networkCheck ??= checkVpnNetworks(this.setupAbort.signal).finally(() => {
      this.networkCheck = undefined
    })
    return this.networkCheck
  }

  installTailscale() {
    this.setupAbort.signal.throwIfAborted()
    this.install ??= this.installTailscaleClient().finally(() => {
      this.install = undefined
    })
    return this.install
  }

  private async installTailscaleClient(): Promise<{ outcome: 'installed' | 'existing' | 'manual-required' }> {
    const statuses = await this.checkNetworks()
    if (statuses.find((status) => status.product === 'tailscale')?.state !== 'not-detected')
      return { outcome: 'existing' }
    if (process.platform !== 'darwin' || process.arch !== 'arm64') return { outcome: 'manual-required' }
    try {
      await application.get('BinaryManager').installSystemPackage('brew-cask:tailscale-app', this.setupAbort.signal)
      return { outcome: 'installed' }
    } catch {
      this.setupAbort.signal.throwIfAborted()
      return { outcome: 'manual-required' }
    }
  }

  protected async onStop(): Promise<void> {
    this.setupAbort.abort()
    await Promise.allSettled([this.networkCheck, this.install])
  }
}
