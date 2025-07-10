import { isDev } from '@main/constant'
import { CacheBatchSpanProcessor, FunctionSpanExporter } from '@mcp-trace/trace-core'
import { NodeTracer as MCPNodeTracer } from '@mcp-trace/trace-node/nodeTracer'
import { context, SpanContext, trace } from '@opentelemetry/api'
import { BrowserWindow, ipcMain } from 'electron'
import { NativeImage, nativeImage } from 'electron'
import * as path from 'path'

import { ConfigKeys, configManager } from './ConfigManager'
import { spanCacheService } from './SpanCacheService'
export function svgToNativeImage(): NativeImage {
  const svgData =
    '<?xml version="1.0" standalone="no"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg t="1750850549641" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="6482" xmlns:xlink="http://www.w3.org/1999/xlink" width="200" height="200"><path d="M919.296 515.072a93.3376 93.3376 0 0 0-31.6928 5.8368l-142.6944-214.1184a108.5952 108.5952 0 0 0 17.3056-58.7264 109.9776 109.9776 0 1 0-192.256 72.192l-143.8208 263.7312a151.5008 151.5008 0 0 0-40.96-6.0928 155.8528 155.8528 0 0 0-84.6848 25.1904l-115.2-138.24a93.2352 93.2352 0 0 0 11.4176-44.032 94.2592 94.2592 0 1 0-57.6 87.04l116.0704 139.264a157.3376 157.3376 0 1 0 226.9184-34.56l141.1072-258.7136a104.0384 104.0384 0 0 0 73.728-5.12l141.7728 212.6336a94.0032 94.0032 0 1 0 80.4864-46.08zM385.28 829.44a94.2592 94.2592 0 1 1 94.208-94.2592A94.3616 94.3616 0 0 1 385.28 829.44z m0 0" p-id="6483"></path></svg><?xml version="1.0" standalone="no"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg t="1750850549641" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="6482" xmlns:xlink="http://www.w3.org/1999/xlink" width="200" height="200"><path d="M919.296 515.072a93.3376 93.3376 0 0 0-31.6928 5.8368l-142.6944-214.1184a108.5952 108.5952 0 0 0 17.3056-58.7264 109.9776 109.9776 0 1 0-192.256 72.192l-143.8208 263.7312a151.5008 151.5008 0 0 0-40.96-6.0928 155.8528 155.8528 0 0 0-84.6848 25.1904l-115.2-138.24a93.2352 93.2352 0 0 0 11.4176-44.032 94.2592 94.2592 0 1 0-57.6 87.04l116.0704 139.264a157.3376 157.3376 0 1 0 226.9184-34.56l141.1072-258.7136a104.0384 104.0384 0 0 0 73.728-5.12l141.7728 212.6336a94.0032 94.0032 0 1 0 80.4864-46.08zM385.28 829.44a94.2592 94.2592 0 1 1 94.208-94.2592A94.3616 94.3616 0 0 1 385.28 829.44z m0 0" p-id="6483"></path></svg>'
  const base64 = btoa(unescape(encodeURIComponent(svgData)))
  console.log(`base64的数据为：${base64}`)
  // 2. 拼接成 data:image/svg+xml;base64,xxx
  const dataUrl = `data:image/svg+xml;base64,${base64}`
  // 3. 创建 NativeImage
  return nativeImage.createFromDataURL(dataUrl)
}

export const TRACER_NAME = 'CherryStudio'

export class NodeTraceService {
  init() {
    const exporter = new FunctionSpanExporter(async (spans) => {
      console.log(`Spans length:`, spans.length)
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

  if (!autoOpen) {
    return
  }

  let iconPath = path.join(__dirname, '../renderer/traceIcon.ico')
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    iconPath = path.join(__dirname, '../../src/renderer/traceIcon.ico')
  }
  const traceIcon = nativeImage.createFromPath(iconPath)

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
    resizable: true,
    title: 'Call Chain Window',
    frame: true,
    titleBarOverlay: { height: 36 },
    icon: traceIcon,
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
