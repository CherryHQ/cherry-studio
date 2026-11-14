import type { MenuItemConstructorOptions } from 'electron'
import { Menu } from 'electron'

import { loggerService } from '@logger'
import { t } from '@main/i18n'

import { buildSpellCheckMenuItems, type SpellCheckMenuItem } from './spellCheckMenu'

const logger = loggerService.withContext('ContextMenu')

class ContextMenu {
  public contextMenu(w: Electron.WebContents) {
    w.on('context-menu', (event, properties) => {
      const editItems = this.createEditMenuItems(properties).filter((item) => item.visible !== false)
      const mayNeedSpellCheck = Boolean(properties.isEditable && properties.selectionText.trim().length > 0)

      // Async custom-dictionary lookup needs preventDefault; skip it when we would show nothing
      // so Chromium can still offer its default page menu on non-editable targets.
      if (editItems.length === 0 && !mayNeedSpellCheck) {
        return
      }

      event.preventDefault()
      void this.popupContextMenu(w, properties, editItems)
    })
  }

  private async popupContextMenu(
    w: Electron.WebContents,
    properties: Electron.ContextMenuParams,
    editItems: MenuItemConstructorOptions[]
  ): Promise<void> {
    let customWords: string[] = []
    if (properties.isEditable && properties.selectionText.trim().length > 0) {
      try {
        customWords = await w.session.listWordsInSpellCheckerDictionary()
      } catch (error) {
        logger.warn('Failed to list spellchecker custom dictionary words', error as Error)
      }
    }

    const spellItems = buildSpellCheckMenuItems({
      isEditable: properties.isEditable,
      selectionText: properties.selectionText,
      misspelledWord: properties.misspelledWord,
      dictionarySuggestions: properties.dictionarySuggestions,
      customWords
    })

    let template: MenuItemConstructorOptions[] = [...editItems, ...this.createInspectMenuItems(w)]
    if (spellItems.length > 0) {
      template = [...this.toSpellCheckMenuTemplate(spellItems, w), { type: 'separator' }, ...template]
    }

    if (template.length === 0) {
      return
    }

    Menu.buildFromTemplate(template).popup()
  }

  private toSpellCheckMenuTemplate(items: SpellCheckMenuItem[], w: Electron.WebContents): MenuItemConstructorOptions[] {
    const template: MenuItemConstructorOptions[] = []

    for (const item of items) {
      switch (item.id) {
        case 'dictionarySuggestion':
          template.push({
            id: 'dictionarySuggestions',
            label: item.label,
            click: () => {
              w.replaceMisspelling(item.suggestion)
            }
          })
          break
        case 'noGuesses':
          template.push({
            id: 'dictionarySuggestions',
            label: t('context_menu.spell_check.no_guesses'),
            enabled: false
          })
          break
        case 'learnSpelling':
          if (template.length > 0) {
            template.push({ type: 'separator' })
          }
          template.push({
            id: 'learnSpelling',
            label: t('context_menu.spell_check.learn'),
            click: () => {
              const ok = w.session.addWordToSpellCheckerDictionary(item.word)
              if (!ok) {
                logger.warn('Failed to add word to spellchecker dictionary', { word: item.word })
              }
            }
          })
          break
        case 'unlearnSpelling':
          template.push({
            id: 'unlearnSpelling',
            label: t('context_menu.spell_check.unlearn'),
            click: () => {
              const ok = w.session.removeWordFromSpellCheckerDictionary(item.word)
              if (!ok) {
                logger.warn('Failed to remove word from spellchecker dictionary', { word: item.word })
              }
            }
          })
          break
      }
    }

    return template
  }

  private createInspectMenuItems(w: Electron.WebContents): MenuItemConstructorOptions[] {
    return [
      {
        id: 'inspect',
        label: t('common.inspect'),
        click: () => {
          w.toggleDevTools()
        },
        enabled: true
      }
    ]
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
}

export const contextMenu = new ContextMenu()
