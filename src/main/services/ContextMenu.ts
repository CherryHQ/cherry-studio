import { Menu, MenuItemConstructorOptions } from 'electron'

import { locales } from '../utils/locales'
import { configManager } from './ConfigManager'

class ContextMenu {
  public contextMenu(w: Electron.BrowserWindow) {
    const locale = configManager.getLanguage()
    // Sets the spellchecker to check English US and French
    w.webContents.session.setSpellCheckerLanguages([locale])

    w.webContents.on('context-menu', (_event, properties) => {
      const template: MenuItemConstructorOptions[] = [
        ...this.createDictionarySuggestions(properties, w),
        { type: 'separator' },
        this.createSpellCheckMenuItem(properties, w),
        { type: 'separator' },
        ...this.createEditMenuItems(properties)
      ]
      const filtered = this.removeInvisibleItems(template)
      if (filtered.length > 0) {
        // Sets the spellchecker to check English US and French
        const menu = Menu.buildFromTemplate(filtered)
        menu.popup({})
      }
    })
  }

  private createDictionarySuggestions(
    properties: Electron.ContextMenuParams,
    win: Electron.BrowserWindow
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
        win.webContents.replaceMisspelling(menuItem.label)
      }
    }))
  }

  private createSpellCheckMenuItem(
    properties: Electron.ContextMenuParams,
    mainWindow: Electron.BrowserWindow
  ): MenuItemConstructorOptions {
    const hasText = properties.selectionText.length > 0

    return {
      id: 'learnSpelling',
      label: '&Learn Spelling',
      visible: Boolean(properties.isEditable && hasText && properties.misspelledWord),
      click: () => {
        mainWindow.webContents.session.addWordToSpellCheckerDictionary(properties.misspelledWord)
      }
    }
  }

  private createEditMenuItems(properties: Electron.ContextMenuParams): MenuItemConstructorOptions[] {
    const locale = locales[configManager.getLanguage()]
    const { common } = locale.translation
    const hasText = properties.selectionText.trim().length > 0
    const can = (type: string) => properties.editFlags[`can${type}`] && hasText

    const template: MenuItemConstructorOptions[] = [
      {
        id: 'copy',
        label: common.copy,
        role: 'copy',
        enabled: can('Copy'),
        visible: properties.isEditable || hasText
      },
      {
        id: 'paste',
        label: common.paste,
        role: 'paste',
        enabled: properties.editFlags.canPaste,
        visible: properties.isEditable
      },
      {
        id: 'cut',
        label: common.cut,
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

  private removeInvisibleItems(template: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
    const filtered = template.filter((item) => item.visible !== false)

    return filtered.reduce((acc, curr, index, arr) => {
      if (index === 0 && curr.type === 'separator') {
        return acc
      }

      if (curr.type === 'separator' && arr[index - 1]?.type === 'separator') {
        return acc
      }

      if (index === arr.length - 1 && curr.type === 'separator') {
        return acc
      }

      acc.push(curr)
      return acc
    }, [] as MenuItemConstructorOptions[])
  }
}

export const contextMenu = new ContextMenu()
