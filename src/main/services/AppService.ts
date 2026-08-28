import { application } from '@application'
import { loggerService } from '@logger'
import { createLatestReconciler, type LatestReconciler } from '@main/core/concurrency/latestReconciler'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isDev, isLinux, isMac, isPortable, isWin } from '@main/core/platform'
import { atomicWriteFile, ensureDir, remove } from '@main/utils/file'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { app } from 'electron'
import path from 'path'

const logger = loggerService.withContext('AppService')

@Injectable('AppService')
@ServicePhase(Phase.WhenReady)
export class AppService extends BaseService {
  private acceptingPreferenceChanges = false
  private desiredLaunchOnBoot = false
  private appliedLaunchOnBoot: boolean | undefined
  private readonly launchOnBootReconciler: LatestReconciler = createLatestReconciler<{
    desired: boolean
    applied: boolean | undefined
  }>({
    name: 'appLaunchOnBoot',
    getSnapshot: () => ({ desired: this.desiredLaunchOnBoot, applied: this.appliedLaunchOnBoot }),
    isSettled: ({ desired, applied }) => desired === applied,
    apply: async ({ desired }) => {
      await this.setAppLaunchOnBoot(desired)
      this.appliedLaunchOnBoot = desired
    },
    onError: (error) => logger.error('Failed to reconcile launch on boot:', error as Error)
  })

  protected onInit(): void {
    // Force a fresh OS sync after a stop→restart in case the setting changed while stopped.
    this.acceptingPreferenceChanges = true
    this.appliedLaunchOnBoot = undefined
    const preferenceService = application.get('PreferenceService')
    this.registerDisposable(
      preferenceService.subscribeChange('app.launch_on_boot', (isLaunchOnBoot) => {
        if (!this.acceptingPreferenceChanges) return
        this.desiredLaunchOnBoot = isLaunchOnBoot
        this.launchOnBootReconciler.request()
      })
    )
    this.desiredLaunchOnBoot = preferenceService.get('app.launch_on_boot')
    this.launchOnBootReconciler.request()
  }

  protected async onStop(): Promise<void> {
    this.acceptingPreferenceChanges = false
    await this.launchOnBootReconciler.flush()
  }

  public async setAppLaunchOnBoot(isLaunchOnBoot: boolean): Promise<void> {
    // Set login item settings for windows and mac
    // linux is not supported because it requires more file operations
    if (isWin || isMac) {
      const settings: Parameters<typeof app.setLoginItemSettings>[0] = { openAtLogin: isLaunchOnBoot }

      // electron-builder's portable launcher sets this to its stable source path.
      // process.execPath points at the extracted Temp payload and becomes stale.
      if (isWin && isPortable && process.env.PORTABLE_EXECUTABLE_FILE) {
        settings.path = process.env.PORTABLE_EXECUTABLE_FILE
        settings.args = []
      }

      app.setLoginItemSettings(settings)
    } else if (isLinux) {
      const autostartDir = AbsoluteFilePathSchema.parse(application.getPath('sys.appdata.autostart'))
      const desktopFile = AbsoluteFilePathSchema.parse(
        path.join(autostartDir, isDev ? 'cherry-studio-dev.desktop' : 'cherry-studio.desktop')
      )

      if (isLaunchOnBoot) {
        await ensureDir(autostartDir)

        // Get executable path
        let executablePath = application.getPath('app.exe_file')
        if (process.env.APPIMAGE) {
          // For AppImage packaged apps, use APPIMAGE environment variable
          executablePath = process.env.APPIMAGE
        }

        // Create desktop file content
        const desktopContent = `[Desktop Entry]
  Type=Application
  Name=Cherry Studio
  Comment=A powerful AI assistant for producer.
  Exec=${executablePath}
  Icon=cherrystudio
  Terminal=false
  StartupNotify=false
  Categories=Development;Utility;
  X-GNOME-Autostart-enabled=true
  Hidden=false`

        await atomicWriteFile(desktopFile, desktopContent)
        logger.info('Created autostart desktop file for Linux')
      } else {
        await remove(desktopFile)
        logger.info('Removed autostart desktop file for Linux')
      }
    }
  }
}
