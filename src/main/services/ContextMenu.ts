import { t } from '@main/i18n'
import type { MenuItemConstructorOptions } from 'electron'
import { BrowserWindow, Menu } from 'electron'

// Without an owner Electron picks one itself — the focused window, else any
// window — and on Windows a menu owned by another window is not dismissed by
// clicks in the one it appears over. Webview guests resolve through their host.
function ownerWindow(w: Electron.WebContents): BrowserWindow | undefined {
  const direct = BrowserWindow.fromWebContents(w)
  if (direct) {
    return direct
  }
  const host = w.hostWebContents
  if (!host || host.isDestroyed()) {
    return undefined
  }
  return BrowserWindow.fromWebContents(host) ?? undefined
}

class ContextMenu {
  public contextMenu(w: Electron.WebContents) {
    w.on('context-menu', (_event, properties) => {
      const template: MenuItemConstructorOptions[] = this.createEditMenuItems(properties)
      const filtered = template.filter((item) => item.visible !== false)
      if (filtered.length > 0) {
        let template = [...filtered, ...this.createInspectMenuItems(w)]
        const dictionarySuggestions = this.createDictionarySuggestions(properties, w)
        if (dictionarySuggestions.length > 0) {
          template = [
            ...dictionarySuggestions,
            { type: 'separator' },
            this.createSpellCheckMenuItem(properties, w),
            { type: 'separator' },
            ...template
          ]
        }
        const menu = Menu.buildFromTemplate(template)
        menu.popup({ window: ownerWindow(w) })
      }
    })
  }

  private createInspectMenuItems(w: Electron.WebContents): MenuItemConstructorOptions[] {
    const template: MenuItemConstructorOptions[] = [
      {
        id: 'inspect',
        label: t('common.inspect'),
        click: () => {
          w.toggleDevTools()
        },
        enabled: true
      }
    ]

    return template
  }

  private createEditMenuItems(properties: Electron.ContextMenuParams): MenuItemConstructorOptions[] {
    const hasText = properties.selectionText.trim().length > 0
    const can = (type: string) => properties.editFlags[`can${type}`] && hasText

    const template: MenuItemConstructorOptions[] = [
      {
        id: 'copy',
        label: t('common.copy'),
        role: 'copy',
        enabled: can('Copy'),
        visible: properties.isEditable || hasText
      },
      {
        id: 'paste',
        label: t('common.paste'),
        role: 'paste',
        enabled: properties.editFlags.canPaste,
        visible: properties.isEditable
      },
      {
        id: 'cut',
        label: t('common.cut'),
        role: 'cut',
        enabled: can('Cut'),
        visible: properties.isEditable
      }
    ]

    // remove role from items that are not enabled
    // https://github.com/electron/electron/issues/13554
    template.forEach((item) => {
      if (item.enabled === false) {
        item.role = undefined
      }
    })

    return template
  }

  private createSpellCheckMenuItem(
    properties: Electron.ContextMenuParams,
    w: Electron.WebContents
  ): MenuItemConstructorOptions {
    const hasText = properties.selectionText.length > 0

    return {
      id: 'learnSpelling',
      label: '&Learn Spelling',
      visible: Boolean(properties.isEditable && hasText && properties.misspelledWord),
      click: () => {
        w.session.addWordToSpellCheckerDictionary(properties.misspelledWord)
      }
    }
  }

  private createDictionarySuggestions(
    properties: Electron.ContextMenuParams,
    w: Electron.WebContents
  ): MenuItemConstructorOptions[] {
    const hasText = properties.selectionText.length > 0

    if (!hasText || !properties.misspelledWord) {
      return []
    }

    if (properties.dictionarySuggestions.length === 0) {
      return [
        {
          id: 'dictionarySuggestions',
          label: 'No Guesses Found',
          visible: true,
          enabled: false
        }
      ]
    }

    return properties.dictionarySuggestions.map((suggestion) => ({
      id: 'dictionarySuggestions',
      label: suggestion,
      visible: Boolean(properties.isEditable && hasText && properties.misspelledWord),
      click: (menuItem: Electron.MenuItem) => {
        w.replaceMisspelling(menuItem.label)
      }
    }))
  }
}

export const contextMenu = new ContextMenu()
