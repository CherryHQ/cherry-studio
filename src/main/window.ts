import { is } from '@electron-toolkit/utils'
import { BrowserWindow, Menu, MenuItem, shell } from 'electron'
import windowStateKeeper from 'electron-window-state'
import { join } from 'path'

import icon from '../../build/icon.png?asset'
import { appConfig, titleBarOverlayDark, titleBarOverlayLight } from './config'

export function createMainWindow() {
  // Load the previous state with fallback to defaults
  const mainWindowState = windowStateKeeper({
    defaultWidth: 1080,
    defaultHeight: 670
  })

  const theme = appConfig.get('theme') || 'light'

  // Create the browser window.
  const mainWindow = new BrowserWindow({
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
    minWidth: 1080,
    minHeight: 600,
    show: true,
    autoHideMenuBar: true,
    transparent: process.platform === 'darwin',
    vibrancy: 'fullscreen-ui',
    visualEffectState: 'active',
    titleBarStyle: 'hidden',
    titleBarOverlay: theme === 'dark' ? titleBarOverlayDark : titleBarOverlayLight,
    trafficLightPosition: { x: 8, y: 12 },
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webSecurity: false,
      webviewTag: true
      // devTools: !app.isPackaged,
    }
  })

  mainWindowState.manage(mainWindow)

  mainWindow.webContents.on('context-menu', () => {
    const menu = new Menu()
    menu.append(new MenuItem({ label: '复制', role: 'copy', sublabel: '⌘ + C' }))
    menu.append(new MenuItem({ label: '粘贴', role: 'paste', sublabel: '⌘ + V' }))
    menu.append(new MenuItem({ label: '剪切', role: 'cut', sublabel: '⌘ + X' }))
    menu.append(new MenuItem({ type: 'separator' }))
    menu.append(new MenuItem({ label: '全选', role: 'selectAll', sublabel: '⌘ + A' }))
    menu.popup()
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    event.preventDefault()
    shell.openExternal(url)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  mainWindow.webContents.session.webRequest.onHeadersReceived({ urls: ['*://*/*'] }, (details, callback) => {
    if (details.responseHeaders?.['X-Frame-Options']) {
      delete details.responseHeaders['X-Frame-Options']
    }
    if (details.responseHeaders?.['x-frame-options']) {
      delete details.responseHeaders['x-frame-options']
    }
    if (details.responseHeaders?.['Content-Security-Policy']) {
      delete details.responseHeaders['Content-Security-Policy']
    }
    if (details.responseHeaders?.['content-security-policy']) {
      delete details.responseHeaders['content-security-policy']
    }
    callback({ cancel: false, responseHeaders: details.responseHeaders })
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

export function createMinappWindow({
  url,
  parent,
  windowOptions
}: {
  url: string
  parent?: BrowserWindow
  windowOptions?: Electron.BrowserWindowConstructorOptions
}) {
  const width = windowOptions?.width || 1000
  const height = windowOptions?.height || 680

  const minappWindow = new BrowserWindow({
    width,
    height,
    autoHideMenuBar: true,
    title: 'Cherry Studio',
    ...windowOptions,
    parent,
    webPreferences: {
      preload: join(__dirname, '../preload/minapp.js'),
      sandbox: false,
      contextIsolation: false
    }
  })

  minappWindow.loadURL(url)

  return minappWindow
}
