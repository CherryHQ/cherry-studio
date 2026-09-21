import type { MenuItemConstructorOptions } from 'electron'
import { Menu, nativeImage, nativeTheme, Tray } from 'electron'

import { application } from '@application'
import { loggerService } from '@logger'
import { type Activatable, BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isLinux, isMac, isWin } from '@main/core/platform'
import { t } from '@main/i18n'

import icon from '../../../build/tray_icon.png?asset'
import iconDark from '../../../build/tray_icon_dark.png?asset'
import iconLight from '../../../build/tray_icon_light.png?asset'

const logger = loggerService.withContext('TrayService')

@Injectable('TrayService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['ComputerUseService'])
export class TrayService extends BaseService implements Activatable {
  private tray: Tray | null = null
  private contextMenu: Menu | null = null

  protected async onInit() {
    this.watchConfigChanges()
    this.registerDisposable(
      application.get('ComputerUseService').onControlsChanged(() => {
        void this.syncVisibility().catch((error) => logger.error('Failed to update control tray', error))
      })
    )
  }

  protected async onReady() {
    if (application.get('PreferenceService').get('app.tray.enabled')) {
      await this.activate()
    }
  }

  onActivate(): void {
    const iconPath = isMac ? (nativeTheme.shouldUseDarkColors ? iconLight : iconDark) : icon
    const tray = new Tray(iconPath)

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
      ...this.computerUseMenu(),
      { type: 'separator' },
      {
        label: t('tray.quit'),
        click: () => this.quit()
      }
    ].filter(Boolean) as MenuItemConstructorOptions[]

    this.contextMenu = Menu.buildFromTemplate(template)
    if (isLinux) this.tray?.setContextMenu(this.contextMenu)
  }

  private computerUseMenu(): MenuItemConstructorOptions[] {
    const service = application.get('ComputerUseService')
    const controls = service.getControls()
    if (!controls.length) return []
    const statusLabels = {
      opening: t('tray.computer_use.opening'),
      active: t('tray.computer_use.active'),
      stopping: t('tray.computer_use.stopping'),
      stopped: t('tray.computer_use.stopped'),
      unconfirmed: t('tray.computer_use.unconfirmed')
    }
    return [
      {
        label: t('tray.computer_use.title'),
        submenu: [
          ...controls.map(
            (control): MenuItemConstructorOptions => ({
              label: t('tray.computer_use.entry', {
                app: (control.appName ?? t('tray.computer_use.all_apps')).replaceAll('&', '&&'),
                task: control.label.replaceAll('&', '&&'),
                status: statusLabels[control.status]
              }),
              submenu: [
                {
                  label: control.status === 'stopped' ? t('tray.computer_use.allow') : t('tray.computer_use.stop'),
                  enabled: ['opening', 'active', 'stopped'].includes(control.status),
                  click: () => {
                    if (control.status === 'stopped') service.allowControl(control.ownerId, control.appId)
                    else if (control.appId) void service.stopApp(control.ownerId, control.appId)
                  }
                }
              ]
            })
          ),
          { type: 'separator' },
          {
            label: t('tray.computer_use.stop_all'),
            enabled: controls.some((control) => ['opening', 'active'].includes(control.status)),
            click: () => {
              void service.stopAll()
            }
          }
        ]
      }
    ]
  }

  private async syncVisibility(): Promise<void> {
    const needed =
      application.get('PreferenceService').get('app.tray.enabled') ||
      application.get('ComputerUseService').getControls().length > 0
    if (needed) {
      await this.activate()
      this.updateContextMenu()
    } else await this.deactivate()
  }

  private watchConfigChanges() {
    const preferenceService = application.get('PreferenceService')
    this.registerDisposable(
      preferenceService.subscribeChange('app.tray.enabled', () => {
        void this.syncVisibility().catch((error) => logger.error('Failed to update tray visibility', error))
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
