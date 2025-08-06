import { loggerService } from '@logger'
import { isDev } from '@main/constant'
import { CacheBatchSpanProcessor, FunctionSpanExporter } from '@mcp-trace/trace-core'
import { NodeTracer as MCPNodeTracer } from '@mcp-trace/trace-node/nodeTracer'
import { context, SpanContext, trace } from '@opentelemetry/api'
import { BrowserWindow, ipcMain } from 'electron'
import * as path from 'path'

import { ConfigKeys, configManager } from './ConfigManager'
import { spanCacheService } from './SpanCacheService'

export const TRACER_NAME = 'CherryStudio'

const logger = loggerService.withContext('NodeTraceService')

export class NodeTraceService {
  init() {
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
}

const originalHandle = ipcMain.handle
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

export const nodeTraceService = new NodeTraceService()

let traceWin: BrowserWindow | null = null

export function openTraceWindow(topicId: string, traceId: string, autoOpen = true, modelName?: string) {
  if (traceWin && !traceWin.isDestroyed()) {
    traceWin.focus()
    traceWin.webContents.send('set-trace', { traceId, topicId, modelName })
    return
  }

  if (!traceWin && !autoOpen) {
    return
  }

  traceWin = new BrowserWindow({
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
    traceWin.loadURL(process.env['ELECTRON_RENDERER_URL'] + `/traceWindow.html`)
  } else {
    traceWin.loadFile(path.join(__dirname, '../renderer/traceWindow.html'))
  }
  traceWin.on('closed', () => {
    configManager.unsubscribe(ConfigKeys.Language, setLanguageCallback)
    try {
      traceWin?.destroy()
    } finally {
      traceWin = null
    }
  })

  traceWin.webContents.on('did-finish-load', () => {
    traceWin!.webContents.send('set-trace', {
      traceId,
      topicId,
      modelName
    })
    traceWin!.webContents.send('set-language', { lang: configManager.get(ConfigKeys.Language) })
    configManager.subscribe(ConfigKeys.Language, setLanguageCallback)
  })
}

const setLanguageCallback = (lang: string) => {
  traceWin!.webContents.send('set-language', { lang })
}

export const setTraceWindowTitle = (title: string) => {
  if (traceWin) {
    traceWin.title = title
  }
}
