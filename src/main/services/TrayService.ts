import { win32 } from 'node:path'

import type { MenuItemConstructorOptions } from 'electron'
import { Menu, nativeImage, nativeTheme, Tray } from 'electron'
import { v5 as uuidv5 } from 'uuid'

import { application } from '@application'
import { type Activatable, BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isLinux, isMac, isPortable, isWin } from '@main/core/platform'
import { getNormalizedExecutablePath } from '@main/core/preboot/userDataLocation'
import { t } from '@main/i18n'
import { getApplicationId } from '@main/utils/appEdition'
import { isRunningWindowsExecutableSigned } from '@main/utils/windowsExecutableSignature'

import icon from '../../../build/tray_icon.png?asset'
import iconDark from '../../../build/tray_icon_dark.png?asset'
import iconLight from '../../../build/tray_icon_light.png?asset'

/** Stable notification-area identity for Explorer (see #21294, #21484). */
function getWindowsTrayGuid(): string {
  const executablePath = win32.resolve(getNormalizedExecutablePath()).toLowerCase()
  return uuidv5(`${getApplicationId()}:${executablePath}`, uuidv5.URL)
}

function shouldUseWindowsTrayGuid(): boolean {
  if (!isPortable) return true
  // Unsigned portable nightlies extract to a new path each launch; Explorer rejects a
  // stable GUID that does not match the running unsigned executable path.
  return isRunningWindowsExecutableSigned()
}

@Injectable('TrayService')
@ServicePhase(Phase.WhenReady)
export class TrayService extends BaseService implements Activatable {
  private tray: Tray | null = null
  private contextMenu: Menu | null = null

  protected async onInit() {
    this.watchConfigChanges()
  }

  protected async onReady() {
    if (application.get('PreferenceService').get('app.tray.enabled')) {
      await this.activate()
    }
  }

  onActivate(): void {
    const iconPath = isMac ? (nativeTheme.shouldUseDarkColors ? iconLight : iconDark) : icon
    const tray = isWin && shouldUseWindowsTrayGuid() ? new Tray(iconPath, getWindowsTrayGuid()) : new Tray(iconPath)

    if (isWin) {
      tray.setImage(iconPath)
    } else if (isMac) {
      const image = nativeImage.createFromPath(iconPath)
      const resizedImage = image.resize({ width: 16, height: 16 })
      resizedImage.setTemplateImage(true)
      tray.setImage(resizedImage)
    } else if (isLinux) {
      const image = nativeImage.createFromPath(iconPath)
      const resizedImage = image.resize({ width: 16, height: 16 })
      tray.setImage(resizedImage)
    }

    this.tray = tray

    this.updateContextMenu()

    if (isLinux) {
      this.tray.setContextMenu(this.contextMenu)
    }

    this.tray.setToolTip('Cherry Studio')

    this.tray.on('right-click', () => {
      if (this.contextMenu) {
        this.tray?.popUpContextMenu(this.contextMenu)
      }
    })

    this.tray.on('click', () => {
      const preferenceService = application.get('PreferenceService')
      const quickAssistantEnabled = preferenceService.get('feature.quick_assistant.enabled')
      const clickTrayToShowQuickAssistant = preferenceService.get('feature.quick_assistant.click_tray_to_show')

      if (quickAssistantEnabled && clickTrayToShowQuickAssistant) {
        application.get('QuickAssistantService').showQuickAssistant()
      } else {
        application.get('MainWindowService').showMainWindow()
      }
    })
  }

  onDeactivate(): void {
    if (this.tray) {
      this.tray.destroy()
      this.tray = null
    }
    this.contextMenu = null
  }

  private updateContextMenu() {
    const preferenceService = application.get('PreferenceService')
    const quickAssistantEnabled = preferenceService.get('feature.quick_assistant.enabled')
    const selectionAssistantEnabled = preferenceService.get('feature.selection.enabled')

    const template = [
      {
        label: t('tray.show_window'),
        click: () => application.get('MainWindowService').showMainWindow()
      },
      quickAssistantEnabled && {
        label: t('tray.show_quick_assistant'),
        click: () => application.get('QuickAssistantService').showQuickAssistant()
      },
      (isWin || isMac) && {
        label: t('selection.name') + (selectionAssistantEnabled ? ' - On' : ' - Off'),
        click: () => {
          application.get('SelectionService').toggleEnabled()
          this.updateContextMenu()
        }
      },
      { type: 'separator' },
      {
        label: t('tray.quit'),
        click: () => this.quit()
      }
    ].filter(Boolean) as MenuItemConstructorOptions[]

    this.contextMenu = Menu.buildFromTemplate(template)
  }

  private watchConfigChanges() {
    const preferenceService = application.get('PreferenceService')
    this.registerDisposable(
      preferenceService.subscribeChange('app.tray.enabled', (enabled: boolean) => {
        if (enabled) void this.activate()
        else void this.deactivate()
      })
    )
    this.registerDisposable(
      preferenceService.subscribeChange('app.language', () => {
        if (this.isActivated) this.updateContextMenu()
      })
    )
    this.registerDisposable(
      preferenceService.subscribeChange('feature.quick_assistant.enabled', () => {
        if (this.isActivated) this.updateContextMenu()
      })
    )
    this.registerDisposable(
      preferenceService.subscribeChange('feature.selection.enabled', () => {
        if (this.isActivated) this.updateContextMenu()
      })
    )
  }

  private quit() {
    application.quit()
  }
}
