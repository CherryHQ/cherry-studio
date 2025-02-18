import { Shortcut } from '@types'
import { BrowserWindow, globalShortcut } from 'electron'
import Logger from 'electron-log'

import { configManager } from './ConfigManager'
import { windowService } from './WindowService'

let showAppAccelerator: string | null = null
let showMiniWindowAccelerator: string | null = null

function getShortcutHandler(shortcut: Shortcut) {
  switch (shortcut.key) {
    case 'zoom_in':
      return (window: BrowserWindow) => handleZoom(0.1)(window)
    case 'zoom_out':
      return (window: BrowserWindow) => handleZoom(-0.1)(window)
    case 'zoom_reset':
      return (window: BrowserWindow) => {
        window.webContents.setZoomFactor(1)
        configManager.setZoomFactor(1)
      }
    case 'show_app':
      return (window: BrowserWindow) => {
        if (window.isVisible()) {
          if (window.isFocused()) {
            window.hide()
          } else {
            window.focus()
          }
        } else {
          window.show()
          window.focus()
        }
      }
    case 'mini_window':
      return () => {
        windowService.toggleMiniWindow()
      }
    default:
      return null
  }
}

function formatShortcutKey(shortcut: string[]): string {
  return shortcut.join('+')
}

function handleZoom(delta: number) {
  return (window: BrowserWindow) => {
    const currentZoom = configManager.getZoomFactor()
    const newZoom = Number((currentZoom + delta).toFixed(1))
    if (newZoom >= 0.1 && newZoom <= 5.0) {
      window.webContents.setZoomFactor(newZoom)
      configManager.setZoomFactor(newZoom)
    }
  }
}

const convertShortcutRecordedByKeyboardEventKeyValueToElectronGlobalShortcutFormat = (
  shortcut: string | string[]
): string => {
  const accelerator = (() => {
    if (Array.isArray(shortcut)) {
      return shortcut
    } else {
      return shortcut.split('+').map((key) => key.trim())
    }
  })()

  return accelerator
    .map((key) => {
      switch (key) {
        case 'Command':
          return 'CommandOrControl'
        case 'Control':
          return 'Control'
        case 'Ctrl':
          return 'Control'
        case 'ArrowUp':
          return 'Up'
        case 'ArrowDown':
          return 'Down'
        case 'ArrowLeft':
          return 'Left'
        case 'ArrowRight':
          return 'Right'
        case 'AltGraph':
          return 'Alt'
        case 'Slash':
          return '/'
        case 'Semicolon':
          return ';'
        case 'BracketLeft':
          return '['
        case 'BracketRight':
          return ']'
        case 'Backslash':
          return '\\'
        case 'Quote':
          return "'"
        case 'Comma':
          return ','
        case 'Minus':
          return '-'
        case 'Equal':
          return '='
        default:
          return key
      }
    })
    .join('+')
}

export function registerShortcuts(window: BrowserWindow) {
  window.once('ready-to-show', () => {
    window.webContents.setZoomFactor(configManager.getZoomFactor())
  })

  const register = () => {
    if (window.isDestroyed()) return

    const shortcuts = configManager.getShortcuts()
    if (!shortcuts) return

    shortcuts.forEach((shortcut) => {
      try {
        if (shortcut.shortcut.length === 0) {
          return
        }

        const handler = getShortcutHandler(shortcut)

        if (!handler) {
          return
        }

        const accelerator = formatShortcutKey(shortcut.shortcut)

        if (shortcut.key === 'show_app' && shortcut.enabled) {
          showAppAccelerator = accelerator
        }

        if (shortcut.key === 'mini_window' && shortcut.enabled) {
          showMiniWindowAccelerator = accelerator
        }

        if (shortcut.key.includes('zoom')) {
          switch (shortcut.key) {
            case 'zoom_in':
              globalShortcut.register('CommandOrControl+=', () => shortcut.enabled && handler(window))
              globalShortcut.register('CommandOrControl+numadd', () => shortcut.enabled && handler(window))
              return
            case 'zoom_out':
              globalShortcut.register('CommandOrControl+-', () => shortcut.enabled && handler(window))
              globalShortcut.register('CommandOrControl+numsub', () => shortcut.enabled && handler(window))
              return
            case 'zoom_reset':
              globalShortcut.register('CommandOrControl+0', () => shortcut.enabled && handler(window))
              return
          }
        }

        if (shortcut.enabled) {
          const accelerator = convertShortcutRecordedByKeyboardEventKeyValueToElectronGlobalShortcutFormat(
            shortcut.shortcut
          )
          globalShortcut.register(accelerator, () => handler(window))
        }
      } catch (error) {
        Logger.error(`[ShortcutService] Failed to register shortcut ${shortcut.key}`)
      }
    })
  }

  const unregister = () => {
    if (window.isDestroyed()) return

    try {
      globalShortcut.unregisterAll()

      if (showAppAccelerator) {
        const handler = getShortcutHandler({ key: 'show_app' } as Shortcut)
        const accelerator =
          convertShortcutRecordedByKeyboardEventKeyValueToElectronGlobalShortcutFormat(showAppAccelerator)
        handler && globalShortcut.register(accelerator, () => handler(window))
      }

      if (showMiniWindowAccelerator) {
        const handler = getShortcutHandler({ key: 'mini_window' } as Shortcut)
        const accelerator =
          convertShortcutRecordedByKeyboardEventKeyValueToElectronGlobalShortcutFormat(showMiniWindowAccelerator)
        handler && globalShortcut.register(accelerator, () => handler(window))
      }
    } catch (error) {
      Logger.error('[ShortcutService] Failed to unregister shortcuts')
    }
  }

  window.on('focus', () => register())
  window.on('blur', () => unregister())

  if (!window.isDestroyed() && window.isFocused()) {
    register()
  }
}

export function unregisterAllShortcuts() {
  try {
    showAppAccelerator = null
    showMiniWindowAccelerator = null
    globalShortcut.unregisterAll()
  } catch (error) {
    Logger.error('[ShortcutService] Failed to unregister all shortcuts')
  }
}
