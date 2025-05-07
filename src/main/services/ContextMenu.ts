import { Menu, MenuItemConstructorOptions } from 'electron'

import { locales } from '../utils/locales'
import { configManager } from './ConfigManager'

class ContextMenu {
  public contextMenu(w: Electron.BrowserWindow) {
    w.webContents.on('context-menu', (_event, properties) => {
      const template: MenuItemConstructorOptions[] = this.createEditMenuItems(properties)
      const filtered = template.filter((item) => item.visible !== false)
      if (filtered.length > 0) {
        const menu = Menu.buildFromTemplate(filtered)
        menu.popup()
      }
    })
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
}

export const contextMenu = new ContextMenu()
