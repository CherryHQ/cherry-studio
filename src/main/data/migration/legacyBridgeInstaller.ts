import fs from 'node:fs'

import { CancellationToken } from 'builder-util-runtime'
import { app } from 'electron'
import {
  AppImageUpdater,
  type AppUpdater,
  DebUpdater,
  MacUpdater,
  NsisUpdater,
  RpmUpdater,
  type ProgressInfo
} from 'electron-updater'
import type { AppAdapter } from 'electron-updater/out/AppAdapter'
import { parse } from 'yaml'

import { application } from '@application'
import { loggerService } from '@logger'
import { getLegacyProfilePaths } from '@main/core/paths/legacyProfilePaths'
import { getNormalizedExecutablePath } from '@main/core/preboot/userDataLocation'
import { bootConfigService } from '@main/data/bootConfig'
import { getAppEdition } from '@main/utils/appEdition'
import type { LegacyInstallState } from '@shared/types/legacyUpgrade'

import { createLegacyBridgeProvider } from './legacyBridgeProvider'
import {
  findLegacyBridgeTarget,
  isLegacyBridgeCompatible,
  type LegacyBridgeTarget,
  type LegacyLinuxPackageType
} from './legacyBridgeTarget'

const logger = loggerService.withContext('LegacyBridgeInstaller')

export function getLegacyLinuxPackageType(): LegacyLinuxPackageType | undefined {
  if (process.platform !== 'linux') return undefined
  if (process.env.APPIMAGE) return 'AppImage'
  try {
    const type = fs.readFileSync(application.getPath('app.extra_resources', 'package-type'), 'utf8').trim()
    return type === 'deb' || type === 'rpm' ? type : undefined
  } catch {
    return undefined
  }
}

export function getLegacyBridgeEligibility(profile: string): { prerequisite: boolean; target?: LegacyBridgeTarget } {
  let prerequisite = true
  try {
    const compatible = isLegacyBridgeCompatible(
      fs.readFileSync(getLegacyProfilePaths(profile).version, 'utf8'),
      process.platform
    )
    if (!compatible) return { prerequisite: true }
    prerequisite = false
    if (!app.isPackaged || profile !== application.getPath('app.userdata')) return { prerequisite: false }
    if (bootConfigService.get('app.user_data_path')?.[getNormalizedExecutablePath()]) return { prerequisite: false }
    if (process.env.PORTABLE_EXECUTABLE_DIR || app.runningUnderARM64Translation) return { prerequisite: false }
    const linuxPackageType = getLegacyLinuxPackageType()
    if (process.platform === 'linux') {
      if (!linuxPackageType) return { prerequisite: false }
      if (linuxPackageType === 'AppImage') fs.accessSync(process.env.APPIMAGE!, fs.constants.W_OK)
    }
    if (process.platform === 'win32') {
      const config = parse(fs.readFileSync(application.getPath('app.extra_resources', 'app-update.yml'), 'utf8'))
      if (!config?.publisherName?.length) return { prerequisite: false }
    }
    return {
      prerequisite: false,
      target: findLegacyBridgeTarget(getAppEdition(), process.platform, process.arch, linuxPackageType)
    }
  } catch (error) {
    logger.warn('Automatic bridge installation unavailable', error as Error)
    return { prerequisite }
  }
}

export function createLegacyBridgeUpdater(target: LegacyBridgeTarget): AppUpdater {
  const cache = application.getPath('feature.legacy_upgrade.cache')
  const adapter: AppAdapter = {
    version: app.getVersion(),
    name: 'legacy-bridge',
    isPackaged: app.isPackaged,
    appUpdateConfigPath: application.getPath('app.extra_resources', 'app-update.yml'),
    userDataPath: cache,
    baseCachePath: cache,
    whenReady: () => app.whenReady(),
    relaunch: () => application.relaunch(),
    quit: () => {
      application.markQuitting()
      app.quit()
    },
    onQuit: () => {
      throw new Error('Bridge installation cannot register automatic on-quit installation')
    }
  }
  const options = createLegacyBridgeProvider(target)
  const updater =
    target.platform === 'darwin'
      ? new MacUpdater(options, adapter)
      : target.platform === 'win32'
        ? new NsisUpdater(options, adapter)
        : target.url.endsWith('.deb')
          ? new DebUpdater(options, adapter)
          : target.url.endsWith('.rpm')
            ? new RpmUpdater(options, adapter)
            : new AppImageUpdater(options, adapter)
  updater.logger = {
    info: (message) => logger.info(String(message)),
    warn: (message) => logger.warn(String(message)),
    error: (message) => logger.error(String(message)),
    debug: (message) => logger.debug(message)
  }
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
  updater.allowDowngrade = true
  updater.disableDifferentialDownload = true
  if (updater instanceof NsisUpdater) updater.installDirectory = application.getPath('app.install')
  return updater
}

export class LegacyBridgeInstaller {
  state: LegacyInstallState = { phase: 'idle' }
  private updater?: AppUpdater
  private token?: CancellationToken
  private task?: Promise<void>
  private disposed = false
  private handoff = false
  private removeError?: () => void

  constructor(
    private readonly createUpdater: () => AppUpdater,
    private readonly publish: (state: LegacyInstallState) => void
  ) {}

  private update(state: LegacyInstallState) {
    this.state = state
    if (!this.disposed) this.publish(state)
  }

  get installing() {
    return this.handoff
  }

  start() {
    if (this.task || this.handoff || this.disposed) return
    this.token = new CancellationToken()
    this.update({ phase: 'preparing' })
    this.task = this.run(this.token).finally(() => {
      this.task = undefined
    })
  }

  private async run(token: CancellationToken) {
    let updater: AppUpdater | undefined
    const onError = (error: Error) => {
      logger.error('Bridge installation failed', error)
      this.handoff = false
      token.cancel()
      if (!this.disposed) this.update({ phase: 'failed' })
      if (!this.task) this.release()
    }
    let previousPercent = -1
    const onProgress = (progress: ProgressInfo) => {
      if (token.cancelled || this.disposed) return
      const percent = progress.total > 0 ? Math.floor(Math.min(100, Math.max(0, progress.percent))) : undefined
      if (percent === previousPercent) return
      previousPercent = percent ?? -1
      this.update({ phase: 'downloading', percent })
    }
    try {
      updater = this.createUpdater()
      this.updater = updater
      updater.on('error', onError)
      this.removeError = () => updater?.removeListener('error', onError)
      updater.on('download-progress', onProgress)
      const result = await updater.checkForUpdates()
      if (token.cancelled || this.disposed) return
      if (!result?.isUpdateAvailable || result.updateInfo.version !== '2.1.0')
        throw new Error('Pinned bridge is unavailable')
      this.update({ phase: 'downloading' })
      await updater.downloadUpdate(token)
      if (token.cancelled || this.disposed) return
      this.handoff = true
      this.update({ phase: 'installing' })
      updater.quitAndInstall(false, true)
    } catch (error) {
      if (!token.cancelled) onError(error instanceof Error ? error : new Error(String(error)))
    } finally {
      updater?.removeListener('download-progress', onProgress)
      if (!this.handoff) {
        updater?.removeListener('error', onError)
        this.release()
        if (this.state.phase !== 'failed') this.update({ phase: 'idle' })
      }
    }
  }

  private release() {
    this.removeError?.()
    this.removeError = undefined
    if (this.updater instanceof MacUpdater) this.updater.dispose()
    this.updater = undefined
  }

  async cancel() {
    if (this.handoff) return
    this.token?.cancel()
    if (this.task) this.update({ phase: 'cancelling' })
    await this.task
  }

  async dispose() {
    if (this.handoff) return
    this.disposed = true
    await this.cancel()
    this.release()
  }
}
