import { loggerService } from '@logger'
import { isDev } from '@main/constant'
import { application } from '@main/core/application'
import { BaseService, DependsOn, Injectable, Phase, Priority, ServicePhase } from '@main/core/lifecycle'
import { CacheBatchSpanProcessor, FunctionSpanExporter } from '@mcp-trace/trace-core'
import { NodeTracer as MCPNodeTracer } from '@mcp-trace/trace-node/nodeTracer'
import type { SpanContext } from '@opentelemetry/api'
import { context, trace } from '@opentelemetry/api'
import { IpcChannel } from '@shared/IpcChannel'
import { BrowserWindow, ipcMain } from 'electron'
import * as path from 'path'

const TRACER_NAME = 'CherryStudio'

const logger = loggerService.withContext('NodeTraceService')

/**
 * Priority(0) ensures this service initializes before all other WhenReady services (default priority is 100).
 * This is critical because onInit() monkey-patches ipcMain.handle() to inject trace context propagation.
 * The patch must be applied BEFORE other services (e.g. WindowService, SpanCacheService) register
 * their IPC handlers via ipcMain.handle(), otherwise those handlers won't receive trace context
 * from the renderer process.
 */
@Injectable('NodeTraceService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['SpanCacheService'])
@Priority(0)
export class NodeTraceService extends BaseService {
  private traceWin: BrowserWindow | null = null
  private unsubscribeLanguage: (() => void) | null = null

  // Saved reference to the original ipcMain.handle, used to restore in onStop()
  private originalHandle: typeof ipcMain.handle | null = null

  protected async onInit() {
    this.patchIpcMainHandle()
    this.initTracer()
    this.registerIpcHandlers()
  }

  protected async onStop() {
    this.destroyTraceWindow()
    this.restoreIpcMainHandle()
    await MCPNodeTracer.shutdown()
  }

  /**
   * Initialize the OpenTelemetry tracer with a CacheBatchSpanProcessor
   * that feeds span data into SpanCacheService.
   */
  private initTracer() {
    const spanCacheService = application.get('SpanCacheService')
    const exporter = new FunctionSpanExporter(async (spans) => {
      logger.info(`Spans length: ${spans.length}`)
    })

    MCPNodeTracer.init(
      {
        defaultTracerName: TRACER_NAME,
        serviceName: TRACER_NAME
      },
      new CacheBatchSpanProcessor(exporter, spanCacheService)
    )
  }

  /**
   * Monkey-patch ipcMain.handle() to transparently propagate OpenTelemetry span context
   * from the renderer process to the main process. When the renderer sends a trace context
   * object as the last IPC argument, this patch extracts it and sets it as the active
   * context for the handler execution, enabling cross-process distributed tracing.
   */
  private patchIpcMainHandle() {
    this.originalHandle = ipcMain.handle
    const originalHandle = this.originalHandle
    ipcMain.handle = (channel: string, handler: (...args: any[]) => Promise<any>) => {
      return originalHandle.call(ipcMain, channel, async (event, ...args) => {
        const carray = args && args.length > 0 ? args[args.length - 1] : {}
        let ctx = context.active()
        let newArgs = args
        if (carray && typeof carray === 'object' && 'type' in carray && carray.type === 'trace') {
          const span = trace.wrapSpanContext(carray.context as SpanContext)
          ctx = trace.setSpan(context.active(), span)
          newArgs = args.slice(0, args.length - 1)
        }
        return context.with(ctx, () => handler(event, ...newArgs))
      })
    }
  }

  /**
   * Restore the original ipcMain.handle() to undo the monkey-patch on shutdown.
   */
  private restoreIpcMainHandle() {
    if (this.originalHandle) {
      ipcMain.handle = this.originalHandle
      this.originalHandle = null
    }
  }

  private registerIpcHandlers() {
    this.ipcHandle(
      IpcChannel.TRACE_OPEN_WINDOW,
      (_, topicId: string, traceId: string, autoOpen?: boolean, modelName?: string) =>
        this.openTraceWindow(topicId, traceId, autoOpen, modelName)
    )
    this.ipcHandle(IpcChannel.TRACE_SET_TITLE, (_, title: string) => this.setTraceWindowTitle(title))
  }

  private openTraceWindow(topicId: string, traceId: string, autoOpen = true, modelName?: string) {
    if (this.traceWin && !this.traceWin.isDestroyed()) {
      this.traceWin.focus()
      this.traceWin.webContents.send('set-trace', { traceId, topicId, modelName })
      return
    }

    if (!this.traceWin && !autoOpen) {
      return
    }

    this.traceWin = new BrowserWindow({
      width: 600,
      minWidth: 500,
      minHeight: 600,
      height: 800,
      autoHideMenuBar: true,
      closable: true,
      focusable: true,
      movable: true,
      hasShadow: true,
      roundedCorners: true,
      maximizable: true,
      minimizable: true,
      resizable: true,
      title: 'Call Chain Window',
      frame: true,
      titleBarOverlay: { height: 40 },
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        devTools: isDev ? true : false
      }
    })

    if (isDev && process.env['ELECTRON_RENDERER_URL']) {
      void this.traceWin.loadURL(process.env['ELECTRON_RENDERER_URL'] + `/traceWindow.html`)
    } else {
      void this.traceWin.loadFile(path.join(__dirname, '../renderer/traceWindow.html'))
    }

    this.traceWin.on('closed', () => {
      if (this.unsubscribeLanguage) {
        this.unsubscribeLanguage()
        this.unsubscribeLanguage = null
      }
      try {
        this.traceWin?.destroy()
      } finally {
        this.traceWin = null
      }
    })

    this.traceWin.webContents.on('did-finish-load', () => {
      const preferenceService = application.get('PreferenceService')
      this.traceWin!.webContents.send('set-trace', {
        traceId,
        topicId,
        modelName
      })
      this.traceWin!.webContents.send('set-language', { lang: preferenceService.get('app.language') })
      this.unsubscribeLanguage = preferenceService.subscribeChange('app.language', (lang: string | null) => {
        if (lang) {
          this.traceWin?.webContents.send('set-language', { lang })
        }
      })
    })
  }

  private setTraceWindowTitle(title: string) {
    if (this.traceWin) {
      this.traceWin.title = title
    }
  }

  private destroyTraceWindow() {
    if (this.unsubscribeLanguage) {
      this.unsubscribeLanguage()
      this.unsubscribeLanguage = null
    }
    if (this.traceWin && !this.traceWin.isDestroyed()) {
      this.traceWin.destroy()
      this.traceWin = null
    }
  }
}
