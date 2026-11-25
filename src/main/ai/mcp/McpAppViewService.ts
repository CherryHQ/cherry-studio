import type { Transport } from '@modelcontextprotocol/client'
import { JSONRPCMessageSchema } from '@modelcontextprotocol/core'
import { AppBridge } from '@modelcontextprotocol/ext-apps/app-bridge'
import { app, nativeTheme, session, webContents, type WebContents, type WebPreferences } from 'electron'

import { application } from '@application'
import { assistantDataService } from '@data/services/AssistantService'
import { mcpServerService } from '@data/services/McpServerService'
import { topicService } from '@data/services/TopicService'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { getAppLanguage } from '@main/i18n'
import type { InputFor, WindowId } from '@shared/ipc/types'
import { mcpAppGuestMessage, mcpAppHostMessage } from '@shared/types/mcpApp'

import { loadMcpApp } from './mcpAppLaunch'
import { installMcpAppNetworkPolicy } from './mcpAppNetwork'
import { MCP_APP_PARTITION_PREFIX, MCP_APP_SCHEME, MCP_APP_SHELL_URL, MCP_APP_VIEW_URL } from './mcpAppResource'

const logger = loggerService.withContext('McpAppView')
const shell = `<!doctype html><meta charset="utf-8">
<style>:root{color-scheme:light dark}html,body,iframe{width:100%;height:100%;margin:0;border:0;display:block;overflow:hidden}iframe{background:Canvas}</style>
<iframe title="MCP App" sandbox="allow-scripts allow-forms" src="${MCP_APP_VIEW_URL}"></iframe>`

type View = {
  windowId: WindowId
  owner: WebContents
  session: Electron.Session
  attachmentAvailable: boolean
  timer: NodeJS.Timeout
  guest?: WebContents
  transport?: Transport
  bridge?: AppBridge
  removeOwnerListeners: () => void
  removeNetworkPolicy: () => void
  payload: Awaited<ReturnType<typeof loadMcpApp>>
}

@Injectable('McpAppViewService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['McpRuntimeService'])
export class McpAppViewService extends BaseService {
  private readonly views = new Map<string, View>()

  protected onInit() {
    this.registerAttachmentGate()
    this.registerDisposable(
      assistantDataService.onChanged((ids) => {
        for (const [id, view] of this.views) {
          if (ids.includes(view.payload.assistantId)) this.canUseView(id, view)
        }
      })
    )
    this.registerDisposable(
      topicService.onChanged((ids) => {
        for (const [id, view] of this.views) {
          if (ids.includes(view.payload.topicId)) this.canUseView(id, view)
        }
      })
    )
    this.registerDisposable(
      mcpServerService.onChanged((serverId) => {
        for (const [id, view] of this.views) {
          if (view.payload.serverId === serverId) void this.dispose(id, 'closed')
        }
      })
    )
    this.ipcOn(mcpAppGuestMessage, (event, raw: unknown) => {
      const view = [...this.views.values()].find((view) => view.guest === event.sender)
      if (
        !view ||
        event.senderFrame?.url !== MCP_APP_SHELL_URL ||
        event.senderFrame.parent !== null ||
        typeof raw !== 'string' ||
        raw.length > 256 * 1024
      )
        return
      try {
        const message = JSONRPCMessageSchema.safeParse(JSON.parse(raw))
        if (message.success) view.transport?.onmessage?.(message.data)
      } catch (error) {
        logger.debug('Invalid MCP App bridge message', { error })
      }
    })
  }

  protected async onStop() {
    await Promise.all([...this.views.keys()].map((id) => this.dispose(id, 'closed')))
  }

  private registerAttachmentGate() {
    const authorize = this.authorizeAttachment.bind(this)
    function gate(
      this: WebContents,
      event: Electron.Event,
      preferences: WebPreferences,
      params: Record<string, string>
    ) {
      if (params.partition?.startsWith(MCP_APP_PARTITION_PREFIX) && !authorize(this, preferences, params)) {
        event.preventDefault()
      }
    }
    const onCreated = (_event: Electron.Event, owner: WebContents) => owner.on('will-attach-webview', gate)
    for (const owner of webContents.getAllWebContents()) owner.on('will-attach-webview', gate)
    app.on('web-contents-created', onCreated)
    this.registerDisposable(() => {
      app.removeListener('web-contents-created', onCreated)
      for (const owner of webContents.getAllWebContents()) owner.removeListener('will-attach-webview', gate)
    })
  }

  async open(windowId: WindowId, input: InputFor<'mcp.app.open'>) {
    const owner = application.get('WindowManager').getWindow(windowId)?.webContents
    if (!owner || owner.isDestroyed()) throw new Error('MCP App requires an active conversation window')
    const id = input.requestId
    if (this.views.has(id) || [...this.views.values()].filter((view) => view.owner === owner).length >= 4) {
      throw new Error('Too many MCP Apps are open')
    }
    const payload = await application
      .get('McpRuntimeService')
      .runDesktopRequest(windowId, id, (signal) => loadMcpApp(input, signal))
    const partition = `${MCP_APP_PARTITION_PREFIX}${id}`
    const guestSession = session.fromPartition(partition, { cache: false })
    const removeNetworkPolicy = await installMcpAppNetworkPolicy(guestSession, payload.resource.origins)
    try {
      payload.verifySource()
      if (
        owner.isDestroyed() ||
        this.views.has(id) ||
        [...this.views.values()].filter((view) => view.owner === owner).length >= 4
      ) {
        throw new Error('MCP App view is unavailable')
      }
    } catch (error) {
      removeNetworkPolicy()
      throw error
    }
    guestSession.setPermissionCheckHandler(() => false)
    guestSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    guestSession.on('will-download', (event) => event.preventDefault())
    guestSession.protocol.handle(MCP_APP_SCHEME, ({ url }) => {
      if (!this.views.has(id)) return new Response(null, { status: 410 })
      if (url === MCP_APP_SHELL_URL) {
        return new Response(shell, {
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'content-security-policy':
              "default-src 'none'; style-src 'unsafe-inline'; frame-src 'self'; base-uri 'none'"
          }
        })
      }
      if (url === MCP_APP_VIEW_URL) {
        return new Response(payload.resource.html, {
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'content-security-policy': payload.resource.csp
          }
        })
      }
      return new Response(null, { status: 404 })
    })
    const timer = setTimeout(() => void this.dispose(id, 'error'), 60_000).unref()
    const onOwnerDestroyed = () => void this.dispose(id, 'closed')
    const onGuestAttached = (_event: Electron.Event, guest: WebContents) => {
      if (guest.session === guestSession) {
        owner.removeListener('did-attach-webview', onGuestAttached)
        this.attach(id, guest)
      }
    }
    const removeOwnerListeners = () => {
      owner.removeListener('destroyed', onOwnerDestroyed)
      owner.removeListener('did-attach-webview', onGuestAttached)
    }
    this.views.set(id, {
      windowId,
      owner,
      session: guestSession,
      attachmentAvailable: true,
      timer,
      payload,
      removeNetworkPolicy,
      removeOwnerListeners
    })
    owner.once('destroyed', onOwnerDestroyed)
    owner.on('did-attach-webview', onGuestAttached)
    return { id, src: MCP_APP_SHELL_URL, partition, origins: payload.resource.origins }
  }

  private authorizeAttachment(owner: WebContents, prefs: WebPreferences, params: Record<string, string>) {
    const id = params.partition?.slice(MCP_APP_PARTITION_PREFIX.length)
    const view = this.views.get(id)
    if (
      !view?.attachmentAvailable ||
      view.owner !== owner ||
      params.src !== MCP_APP_SHELL_URL ||
      params.preload ||
      params.webpreferences ||
      params.allowpopups ||
      params.blinkfeatures ||
      params.disableblinkfeatures ||
      !this.canUseView(id, view)
    )
      return false
    view.attachmentAvailable = false
    Object.assign(prefs, {
      preload: application.getPath('feature.mcp.app_preload_file'),
      sandbox: true,
      webSecurity: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      webviewTag: false,
      allowRunningInsecureContent: false
    } satisfies WebPreferences)
    return true
  }

  private attach(id: string, guest: WebContents) {
    const view = this.views.get(id)
    if (!view || view.attachmentAvailable || view.guest) {
      guest.close()
      return
    }
    view.guest = guest
    clearTimeout(view.timer)
    view.timer = setTimeout(() => void this.dispose(id, 'error'), 15_000).unref()
    guest.setWindowOpenHandler(() => ({ action: 'deny' }))
    guest.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')
    guest.on('will-navigate', (event) => event.preventDefault())
    guest.on('will-redirect', (event) => event.preventDefault())
    guest.on('will-frame-navigate', (event) => {
      if (event.isMainFrame || event.url !== MCP_APP_VIEW_URL || event.initiator?.parent !== null)
        event.preventDefault()
    })
    guest.once('render-process-gone', () => void this.dispose(id, 'error'))
    guest.once('destroyed', () => void this.dispose(id, 'closed'))
    guest.on('did-fail-load', (_event, errorCode, _description, _url, isMainFrame) => {
      if (isMainFrame && errorCode !== -3) void this.dispose(id, 'error')
    })

    const bridge = new AppBridge(
      null,
      { name: 'Cherry Studio', version: '1' },
      {},
      {
        hostContext: {
          displayMode: 'inline',
          availableDisplayModes: ['inline'],
          locale: getAppLanguage(),
          theme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
        }
      }
    )
    const transport: Transport = {
      async start() {},
      async send(message) {
        if (!guest.isDestroyed()) guest.send(mcpAppHostMessage, message)
      },
      async close() {
        transport.onclose?.()
      }
    }
    view.transport = transport
    view.bridge = bridge
    bridge.onsizechange = ({ height }) => {
      if (typeof height !== 'number' || !Number.isFinite(height)) return
      this.send(view, id, 'size', Math.min(640, Math.max(80, Math.ceil(height))))
    }
    bridge.oninitialized = () => {
      void (async () => {
        if (!this.canUseView(id, view)) return
        await bridge.sendToolInput({ arguments: view.payload.args })
        if (!this.canUseView(id, view)) return
        await bridge.sendToolResult(view.payload.result)
        if (this.views.get(id) !== view) return
        clearTimeout(view.timer)
        this.send(view, id, 'ready')
      })().catch((error) => {
        logger.warn('Unable to initialize MCP App', { error })
        void this.dispose(id, 'error')
      })
    }
    void bridge.connect(transport).catch((error) => {
      logger.warn('Unable to connect MCP App bridge', { error })
      void this.dispose(id, 'error')
    })
  }

  async close(windowId: WindowId, id: string) {
    if (this.views.get(id)?.windowId === windowId) await this.dispose(id, 'closed')
  }

  private send(view: View, id: string, state: 'ready' | 'size' | 'closed' | 'error', height?: number) {
    application.get('IpcApiService').send(view.windowId, 'mcp.app.state_changed', { id, state, height })
  }

  private canUseView(id: string, view: View): boolean {
    if (this.views.get(id) !== view) return false
    try {
      view.payload.verifySource()
      return true
    } catch {
      void this.dispose(id, 'closed')
      return false
    }
  }

  private async dispose(id: string, state: 'closed' | 'error') {
    const view = this.views.get(id)
    if (!view) return
    this.views.delete(id)
    clearTimeout(view.timer)
    view.removeOwnerListeners()
    view.removeNetworkPolicy()
    view.session.protocol.unhandle(MCP_APP_SCHEME)
    await view.bridge?.close().catch((error) => logger.debug('Unable to close MCP App bridge', { error }))
    if (view.guest && !view.guest.isDestroyed()) view.guest.close()
    this.send(view, id, state)
  }
}
