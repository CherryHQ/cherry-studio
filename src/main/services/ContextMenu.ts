import { Menu, MenuItemConstructorOptions } from 'electron'

import { locales } from '../utils/locales'
import { configManager } from './ConfigManager'

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
        menu.popup()
      }
    })
  }

  private createInspectMenuItems(w: Electron.WebContents): MenuItemConstructorOptions[] {
    const locale = locales[configManager.getLanguage()]
    const { common } = locale.translation
    const template: MenuItemConstructorOptions[] = [
      {
        id: 'inspect',
        label: common.inspect,
        click: () => {
          w.toggleDevTools()
        },
        enabled: true
      }
    ]

    return template
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
