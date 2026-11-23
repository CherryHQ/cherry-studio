import fs from 'node:fs'

import { CancellationToken } from 'builder-util-runtime'
import { app } from 'electron'
import {
  AppImageUpdater,
  type AppUpdater,
  DebUpdater,
  MacUpdater,
  NsisUpdater,
  PortableUpdater,
  RpmUpdater,
  type ProgressInfo
} from 'electron-updater'
import type { AppAdapter } from 'electron-updater/out/AppAdapter'
import { parse } from 'yaml'

import { application } from '@application'
import { loggerService } from '@logger'
import { getLegacyProfilePaths } from '@main/core/paths/legacyProfilePaths'
import { getNormalizedExecutablePath, isUsableDataDir } from '@main/core/preboot/userDataLocation'
import { bootConfigService } from '@main/data/bootConfig'
import { getAppEdition } from '@main/utils/appEdition'
import type { LegacyInstallState } from '@shared/types/legacyUpgrade'

import { createLegacyBridgeProvider } from './legacyBridgeProvider'
import {
  findLegacyBridgeTarget,
  getLegacyBridgeVersion,
  LEGACY_PREREQUISITE_VERSION,
  type LegacyBridgeTarget,
  type LegacyBridgeVersion,
  type LegacyLinuxPackageType
} from './legacyBridgeTarget'
import { isLegacyPortableDefaultProfile } from './legacyUpgrade'

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
    const version = getLegacyBridgeVersion(
      fs.readFileSync(getLegacyProfilePaths(profile).version, 'utf8'),
      process.platform
    )
    if (!version) return { prerequisite }
    prerequisite = version === LEGACY_PREREQUISITE_VERSION
    if (!app.isPackaged || !isUsableDataDir(profile) || app.runningUnderARM64Translation) return { prerequisite }
    const portableDir = process.platform === 'win32' ? process.env.PORTABLE_EXECUTABLE_DIR : undefined
    const portable = portableDir !== undefined
    if (portable) {
      const executable = application.getPath('app.portable_executable')
      if (!executable) return { prerequisite }
      fs.accessSync(executable, fs.constants.R_OK | fs.constants.W_OK)
    }
    if (prerequisite && (!portableDir || !isLegacyPortableDefaultProfile(profile, portableDir))) {
      return { prerequisite }
    }
    const linuxPackageType = getLegacyLinuxPackageType()
    if (process.platform === 'linux') {
      if (!linuxPackageType) return { prerequisite: false }
      if (linuxPackageType === 'AppImage') fs.accessSync(process.env.APPIMAGE!, fs.constants.W_OK)
    }
    if (process.platform === 'win32' && !portable) {
      const config = parse(fs.readFileSync(application.getPath('app.extra_resources', 'app-update.yml'), 'utf8'))
      if (!config?.publisherName?.length) return { prerequisite: false }
    }
    return {
      prerequisite,
      target: findLegacyBridgeTarget(
        getAppEdition(),
        process.platform,
        process.arch,
        linuxPackageType,
        portable,
        version
      )
    }
  } catch (error) {
    logger.warn('Automatic bridge installation unavailable', error as Error)
    return { prerequisite }
  }
}

export function createLegacyBridgeUpdater(target: LegacyBridgeTarget): AppUpdater {
  const cache = application.getPath('feature.legacy_upgrade.cache', target.version)
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
        ? target.url.endsWith('-portable.exe')
          ? new PortableUpdater(options, adapter)
          : new NsisUpdater(options, adapter)
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
  if (updater instanceof PortableUpdater) {
    updater.portableExecutable = application.getPath('app.portable_executable')
    updater.portableSha512 = target.sha512
  }
  if (updater instanceof NsisUpdater && !(updater instanceof PortableUpdater))
    updater.installDirectory = application.getPath('app.install')
  return updater
}

export function prepareLegacyBridgeProfile(profile: string): () => void {
  if (!isUsableDataDir(profile)) throw new Error('Migration data directory is unavailable')
  const executable = getNormalizedExecutablePath()
  const previous = bootConfigService.get('app.user_data_path')
  if (previous?.[executable] === profile) return () => {}
  const restore = () => {
    bootConfigService.set('app.user_data_path', previous)
    bootConfigService.persist()
  }
  bootConfigService.set('app.user_data_path', { ...previous, [executable]: profile })
  try {
    bootConfigService.persist()
  } catch (error) {
    bootConfigService.set('app.user_data_path', previous)
    throw error
  }
  return restore
}

type PortableFollowup = Pick<LegacyBridgeTarget, 'version' | 'sha512'> & {
  createUpdater: () => AppUpdater
  versionLog: string
}

export class LegacyBridgeInstaller {
  state: LegacyInstallState = { phase: 'idle' }
  private updater?: AppUpdater
  private token?: CancellationToken
  private task?: Promise<void>
  private disposed = false
  private handoff = false
  private removeError?: () => void
  private restoreProfile?: () => void

  constructor(
    private readonly version: LegacyBridgeVersion,
    private readonly createUpdater: () => AppUpdater,
    private readonly publish: (state: LegacyInstallState) => void,
    private readonly prepareProfile: () => () => void = () => () => {},
    private readonly followup?: PortableFollowup
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
    let nextUpdater: AppUpdater | undefined
    let downloadStage = 0
    const onError = (error: Error) => {
      logger.error('Bridge installation failed', error)
      this.handoff = false
      try {
        this.restoreProfile?.()
      } catch (restoreError) {
        logger.error('Cannot restore profile mapping after installation failure', restoreError as Error)
      }
      this.restoreProfile = undefined
      token.cancel()
      if (!this.disposed) this.update({ phase: 'failed' })
      if (!this.task) this.release()
    }
    let previousPercent = -1
    const onProgress = (progress: ProgressInfo) => {
      if (token.cancelled || this.disposed) return
      const percent = progress.total > 0 ? Math.floor(Math.min(100, Math.max(0, progress.percent))) : undefined
      const totalPercent =
        percent === undefined || !this.followup ? percent : Math.floor((downloadStage * 100 + percent) / 2)
      if (totalPercent === previousPercent) return
      previousPercent = totalPercent ?? -1
      this.update({ phase: 'downloading', percent: totalPercent })
    }
    const download = async (stageUpdater: AppUpdater, version: LegacyBridgeVersion) => {
      stageUpdater.on('download-progress', onProgress)
      const result = await stageUpdater.checkForUpdates()
      if (token.cancelled || this.disposed) return
      if (!result?.isUpdateAvailable || result.updateInfo.version !== version)
        throw new Error('Pinned bridge is unavailable')
      this.update(downloadStage ? { phase: 'downloading', percent: 50 } : { phase: 'downloading' })
      return stageUpdater.downloadUpdate(token)
    }
    try {
      updater = this.createUpdater()
      this.updater = updater
      updater.on('error', onError)
      this.removeError = () => updater?.removeListener('error', onError)
      await download(updater, this.version)
      if (token.cancelled || this.disposed) return
      if (this.followup) {
        if (!(updater instanceof PortableUpdater)) throw new Error('Portable follow-up requires the portable updater')
        updater.removeListener('download-progress', onProgress)
        downloadStage = 1
        nextUpdater = this.followup.createUpdater()
        nextUpdater.on('error', onError)
        const files = await download(nextUpdater, this.followup.version)
        if (token.cancelled || this.disposed) return
        if (files?.length !== 1) throw new Error('Missing portable follow-up download')
        updater.portableFollowup = {
          source: files[0],
          sha512: this.followup.sha512,
          versionLog: this.followup.versionLog,
          prerequisiteVersion: this.version
        }
      }
      this.restoreProfile = this.prepareProfile()
      this.handoff = true
      this.update({ phase: 'installing' })
      updater.quitAndInstall(false, true)
    } catch (error) {
      if (!token.cancelled) onError(error instanceof Error ? error : new Error(String(error)))
    } finally {
      updater?.removeListener('download-progress', onProgress)
      nextUpdater?.removeListener('download-progress', onProgress)
      nextUpdater?.removeListener('error', onError)
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
