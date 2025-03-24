import { ProxyConfig as _ProxyConfig, session } from 'electron'
import { socksDispatcher } from 'fetch-socks'
import { ProxyAgent as GeneralProxyAgent } from 'proxy-agent'
import { ProxyAgent, setGlobalDispatcher } from 'undici'

type ProxyMode = 'system' | 'custom' | 'none'

export interface ProxyConfig {
  mode: ProxyMode
  url?: string
}

export class ProxyManager {
  private config: ProxyConfig
  private proxyAgent: GeneralProxyAgent | null = null
  private systemProxyInterval: NodeJS.Timeout | null = null

  constructor() {
    this.config = {
      mode: 'none'
    }
  }

  private async setSessionsProxy(config: _ProxyConfig): Promise<void> {
    const sessions = [session.defaultSession, session.fromPartition('persist:webview')]
    await Promise.all(sessions.map((session) => session.setProxy(config)))
  }

  private async monitorSystemProxy(): Promise<void> {
    // Clear any existing interval first
    this.clearSystemProxyMonitor()
    // Set new interval
    this.systemProxyInterval = setInterval(async () => {
      await this.setSystemProxy()
    }, 10000)
  }

  private clearSystemProxyMonitor(): void {
    if (this.systemProxyInterval) {
      clearInterval(this.systemProxyInterval)
      this.systemProxyInterval = null
    }
  }

  async configureProxy(config: ProxyConfig): Promise<void> {
    try {
      this.config = config
      this.clearSystemProxyMonitor()
      if (this.config.mode === 'system') {
        await this.setSystemProxy()
        this.monitorSystemProxy()
      } else if (this.config.mode === 'custom') {
        await this.setCustomProxy()
      } else {
        await this.clearProxy()
      }
    } catch (error) {
      console.error('Failed to config proxy:', error)
      throw error
    }
  }

  private setEnvironment(url: string): void {
    process.env.grpc_proxy = url
    process.env.HTTP_PROXY = url
    process.env.HTTPS_PROXY = url
    process.env.http_proxy = url
    process.env.https_proxy = url
  }

  private async setSystemProxy(): Promise<void> {
    try {
      await this.setSessionsProxy({ mode: 'system' })
      const proxyString = await session.defaultSession.resolveProxy('https://dummy.com')
      const [protocol, address] = proxyString.split(';')[0].split(' ')
      const url = protocol === 'PROXY' ? `http://${address}` : null
      if (url && url !== this.config.url) {
        this.config.url = url.toLowerCase()
        this.setEnvironment(this.config.url)
        this.proxyAgent = new GeneralProxyAgent()
      }
    } catch (error) {
      console.error('Failed to set system proxy:', error)
      throw error
    }
  }

  private async setCustomProxy(): Promise<void> {
    try {
      if (this.config.url) {
        this.setEnvironment(this.config.url)
        this.proxyAgent = new GeneralProxyAgent()
        await this.setSessionsProxy({ proxyRules: this.config.url })
      }
    } catch (error) {
      console.error('Failed to set custom proxy:', error)
      throw error
    }
  }

  private clearEnvironment(): void {
    delete process.env.HTTP_PROXY
    delete process.env.HTTPS_PROXY
    delete process.env.grpc_proxy
    delete process.env.http_proxy
    delete process.env.https_proxy
  }

  private async clearProxy(): Promise<void> {
    this.clearEnvironment()
    await this.setSessionsProxy({ mode: 'direct' })
    this.config = { mode: 'none' }
    this.proxyAgent = null
  }

  getProxyAgent(): GeneralProxyAgent | null {
    return this.proxyAgent
  }

  getProxyUrl(): string {
    return this.config.url || ''
  }

  setGlobalProxy() {
    const proxyUrl = this.config.url
    if (proxyUrl) {
      const [protocol, address] = proxyUrl.split('://')
      const [host, port] = address.split(':')
      if (!protocol.includes('socks')) {
        setGlobalDispatcher(new ProxyAgent(proxyUrl))
      } else {
        const dispatcher = socksDispatcher({
          port: parseInt(port),
          type: protocol === 'socks5' ? 5 : 4,
          host: host
        })
        global[Symbol.for('undici.globalDispatcher.1')] = dispatcher
      }
    }
  }
}

export const proxyManager = new ProxyManager()
