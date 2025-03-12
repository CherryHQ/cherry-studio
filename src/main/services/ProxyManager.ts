import { ProxyConfig as _ProxyConfig, session } from 'electron'
import { socksDispatcher } from 'fetch-socks'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { ProxyAgent, setGlobalDispatcher } from 'undici'

type ProxyMode = 'system' | 'custom' | 'none'

export interface ProxyConfig {
  mode: ProxyMode
  url?: string | null
}

export class ProxyManager {
  private config: ProxyConfig
  private proxyAgent: HttpsProxyAgent | null = null
  private proxyUrl: string | null = null

  constructor() {
    this.config = {
      mode: 'system',
      url: ''
    }
    this.monitorSystemProxy()
  }

  private async setSessionsProxy(config: _ProxyConfig): Promise<void> {
    const sessions = [session.defaultSession, session.fromPartition('persist:webview')]
    await Promise.all(sessions.map((session) => session.setProxy(config)))
  }

  private async monitorSystemProxy(): Promise<void> {
    setInterval(async () => {
      await this.setSystemProxy()
    }, 10000)
  }

  async configureProxy(config: ProxyConfig): Promise<void> {
    try {
      this.config = config
      if (this.config.mode === 'system') {
        await this.setSystemProxy()
      } else if (this.config.mode == 'custom') {
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
      const url = await this.resolveSystemProxy()
      if (url && url !== this.proxyUrl) {
        this.proxyUrl = url.toLowerCase()
        this.proxyAgent = new HttpsProxyAgent(this.proxyUrl)
        this.setEnvironment(this.proxyUrl)
      }
    } catch (error) {
      console.error('Failed to set system proxy:', error)
      throw error
    }
  }

  private async setCustomProxy(): Promise<void> {
    try {
      if (this.config.url) {
        this.proxyUrl = this.config.url.toLowerCase()
        this.proxyAgent = new HttpsProxyAgent(this.proxyUrl)
        this.setEnvironment(this.proxyUrl)
        await this.setSessionsProxy({ proxyRules: this.proxyUrl })
      }
    } catch (error) {
      console.error('Failed to set custom proxy:', error)
      throw error
    }
  }

  private async clearProxy(): Promise<void> {
    delete process.env.HTTP_PROXY
    delete process.env.HTTPS_PROXY
    await this.setSessionsProxy({})
    this.config = { mode: 'none' }
    this.proxyAgent = null
    this.proxyUrl = null
  }

  private async resolveSystemProxy(): Promise<string | null> {
    try {
      return await this.resolveElectronProxy()
    } catch (error) {
      console.error('Failed to resolve system proxy:', error)
      return null
    }
  }

  private async resolveElectronProxy(): Promise<string | null> {
    try {
      const proxyString = await session.defaultSession.resolveProxy('https://dummy.com')
      const [protocol, address] = proxyString.split(';')[0].split(' ')
      return protocol === 'PROXY' ? `http://${address}` : null
    } catch (error) {
      console.error('Failed to resolve electron proxy:', error)
      return null
    }
  }

  getProxyAgent(): HttpsProxyAgent | null {
    return this.proxyAgent
  }

  getProxyUrl(): string | null {
    return this.proxyUrl
  }

  setGlobalProxy() {
    const proxyUrl = this.proxyUrl
    if (proxyUrl) {
      const [protocol, host, port] = proxyUrl.split(':')
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
