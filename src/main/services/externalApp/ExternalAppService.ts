import { spawn } from 'node:child_process'
import { lstatSync, statSync } from 'node:fs'
import path from 'node:path'

import { app, shell } from 'electron'

import { application } from '@application'
import { loggerService } from '@logger'
import { safeOpen, showInFolder } from '@main/services/file'
import { isSafeExternalUrl } from '@main/utils/externalUrlSafety'
import { removeEnvProxy } from '@main/utils/processRunner'
import type { ExternalOpenTarget, ExternalOpenTargetResult } from '@shared/types/externalApp'
import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'
import { isDangerExt, normalizeExt } from '@shared/utils/file'

import {
  listNativeApplications,
  nativeApplicationIcon,
  type NativeApplication,
  nativeTargetId,
  openNativeApplication
} from './nativeApplication'

const SYSTEM_DEFAULT_TARGET_ID = 'system_default'
const FILE_MANAGER_TARGET_ID = 'file_manager'
const KNOWN_TARGET_PREFIX = 'known:'
const NATIVE_TARGET_PREFIX = 'native:'
const CACHE_DURATION_MS = 5 * 60 * 1000
const INSTALLED_APPS_CACHE_KEY = 'external-app:installed-apps'
const openTargetsCacheKey = (key: string) => `external-app:open-targets:${key}`
const logger = loggerService.withContext('ExternalAppService')

type KnownExternalAppId = 'vscode' | 'cursor' | 'zed' | 'wt'
type ExternalOpenTargetPathKind = ExternalOpenTargetResult['pathKind']

/** Compares display names so an application the OS already reported is not listed twice. */
function normalizeApplicationName(name: string): string {
  return name.trim().toLowerCase()
}

interface KnownExternalAppConfig {
  id: KnownExternalAppId
  name: string
  protocol?: string
  executable?: string
  kind: 'application' | 'terminal'
  pathKinds: ExternalOpenTargetPathKind[]
}

interface InstalledKnownExternalApp extends KnownExternalAppConfig {
  path: string
}

const SUPPORTED_EXTERNAL_APPS = [
  {
    id: 'vscode',
    name: 'Visual Studio Code',
    protocol: 'vscode://',
    kind: 'application',
    pathKinds: ['file', 'directory']
  },
  {
    id: 'cursor',
    name: 'Cursor',
    protocol: 'cursor://',
    kind: 'application',
    pathKinds: ['file', 'directory']
  },
  {
    id: 'zed',
    name: 'Zed',
    protocol: 'zed://',
    kind: 'application',
    pathKinds: ['file', 'directory']
  },
  {
    id: 'wt',
    name: 'Windows Terminal',
    executable: 'wt.exe',
    kind: 'terminal',
    pathKinds: ['directory']
  }
] satisfies readonly KnownExternalAppConfig[]

export class ExternalAppService {
  async listOpenTargets(
    inputPath: string,
    pathKindHint?: ExternalOpenTargetPathKind
  ): Promise<ExternalOpenTargetResult> {
    const targetPath = this.resolveTargetPath(inputPath)
    const pathKind = this.getPathKind(targetPath, pathKindHint)
    const cacheKey = this.getCacheKey(targetPath, pathKind)
    const cacheService = application.get('CacheService')
    const cached = cacheService.get<ExternalOpenTargetResult>(openTargetsCacheKey(cacheKey))
    if (cached) return cached

    const result =
      pathKind === 'directory' ? await this.listDirectoryTargets(targetPath) : await this.listFileTargets(targetPath)
    cacheService.set(openTargetsCacheKey(cacheKey), result, CACHE_DURATION_MS)
    return result
  }

  async openTarget(inputPath: string, targetId: string, pathKindHint?: ExternalOpenTargetPathKind): Promise<void> {
    const targetPath = this.resolveTargetPath(inputPath)
    if (targetId.startsWith(KNOWN_TARGET_PREFIX)) {
      const pathKind = this.getPathKind(targetPath, pathKindHint)
      const apps = await this.detectInstalledApps()
      const app = apps.find(
        (item) => item.id === targetId.slice(KNOWN_TARGET_PREFIX.length) && item.pathKinds.includes(pathKind)
      )
      if (!app) throw new Error(`Open target "${targetId}" is not available for this path`)
      await this.openKnownApplication(app.id, targetPath, pathKind)
      return
    }
    if (targetId.startsWith(NATIVE_TARGET_PREFIX)) {
      const pathKind = this.getPathKind(targetPath, pathKindHint)
      if (pathKind === 'file' && isDangerExt(normalizeExt(path.extname(targetPath)))) {
        throw new Error(`Open target "${targetId}" is not available for this path`)
      }
      const applications = await this.listNativeApplicationsOrEmpty(targetPath)
      const selected = applications.find((item) => nativeTargetId(item.id) === targetId)
      if (!selected) throw new Error(`Open target "${targetId}" is not available for this path`)
      await openNativeApplication(targetPath, selected.id)
      return
    }
    const result = await this.listOpenTargets(targetPath, pathKindHint)
    const target = result.targets.find((item) => item.id === targetId)
    if (!target) throw new Error(`Open target "${targetId}" is not available for this path`)

    if (target.id === SYSTEM_DEFAULT_TARGET_ID) {
      await safeOpen(targetPath)
      return
    }
    if (target.id === FILE_MANAGER_TARGET_ID) {
      if (result.pathKind === 'file') await showInFolder(targetPath)
      else await safeOpen(targetPath)
      return
    }
    throw new Error(`Open target "${targetId}" cannot be launched on this platform`)
  }

  /**
   * Association enumeration is the only authority for a native identity, so a failed lookup leaves
   * nothing to authorize and the caller reports the target as unavailable.
   */
  private async listNativeApplicationsOrEmpty(targetPath: AbsoluteFilePath): Promise<NativeApplication[]> {
    try {
      return (await listNativeApplications(targetPath)).applications
    } catch (error) {
      logger.warn('Failed to discover file associations', error as Error)
      return []
    }
  }

  private async listDirectoryTargets(targetPath: AbsoluteFilePath): Promise<ExternalOpenTargetResult> {
    const { targets: nativeTargets, names: nativeNames } = await this.listNativeDirectoryTargets(targetPath)
    const compatibleApps = (await this.detectInstalledApps()).filter((item) => item.pathKinds.includes('directory'))
    const knownTargets = compatibleApps
      .filter((item) => !nativeNames.has(normalizeApplicationName(item.name)))
      .map((item) => this.toKnownTarget(item))
    const applicationTargets = knownTargets.filter((item) => item.kind === 'application')
    const terminalTargets = knownTargets.filter((item) => item.kind === 'terminal')
    return {
      pathKind: 'directory',
      recommendedTargetId: FILE_MANAGER_TARGET_ID,
      targets: [
        { id: FILE_MANAGER_TARGET_ID, kind: 'file_manager' },
        ...nativeTargets,
        ...applicationTargets,
        ...terminalTargets
      ]
    }
  }

  /**
   * Every application the OS registers for folders, minus the system file manager: the
   * `file_manager` row already opens folders with it, so listing it again would duplicate a row.
   */
  private async listNativeDirectoryTargets(
    targetPath: AbsoluteFilePath
  ): Promise<{ targets: ExternalOpenTarget[]; names: Set<string> }> {
    const targets: ExternalOpenTarget[] = []
    const names = new Set<string>()
    try {
      const { applications, defaultApplication } = await listNativeApplications(targetPath)
      const seen = new Set<string>(defaultApplication ? [defaultApplication.id] : [])
      for (const item of applications) {
        if (seen.has(item.id)) continue
        seen.add(item.id)
        names.add(normalizeApplicationName(item.name))
        targets.push({
          id: nativeTargetId(item.id),
          kind: 'application',
          name: item.name,
          iconDataUrl: await nativeApplicationIcon(item)
        })
      }
    } catch (error) {
      logger.warn('Failed to discover directory associations', error as Error)
    }
    return { targets, names }
  }

  private async listFileTargets(targetPath: AbsoluteFilePath): Promise<ExternalOpenTargetResult> {
    if (isDangerExt(normalizeExt(path.extname(targetPath)))) {
      const apps = await this.detectInstalledApps()
      const editors = apps
        .filter((item) => item.kind === 'application' && item.pathKinds.includes('file'))
        .map((item) => this.toKnownTarget(item))
      return {
        pathKind: 'file',
        recommendedTargetId: editors[0]?.id ?? FILE_MANAGER_TARGET_ID,
        targets: [{ id: FILE_MANAGER_TARGET_ID, kind: 'file_manager' }, ...editors]
      }
    }

    const targets: ExternalOpenTarget[] = [
      { id: SYSTEM_DEFAULT_TARGET_ID, kind: 'system_default' },
      { id: FILE_MANAGER_TARGET_ID, kind: 'file_manager' }
    ]
    try {
      const { applications, defaultApplication } = await listNativeApplications(targetPath)
      if (defaultApplication) {
        targets[0] = {
          id: SYSTEM_DEFAULT_TARGET_ID,
          kind: 'system_default',
          name: defaultApplication.name,
          iconDataUrl: await nativeApplicationIcon(defaultApplication)
        }
      }
      const seen = new Set(defaultApplication?.id ? [defaultApplication.id] : [])
      for (const item of applications) {
        if (seen.has(item.id)) continue
        seen.add(item.id)
        targets.push({
          id: nativeTargetId(item.id),
          kind: 'application',
          name: item.name,
          iconDataUrl: await nativeApplicationIcon(item)
        })
      }
    } catch (error) {
      logger.warn('Failed to discover file associations', error as Error)
    }
    return { pathKind: 'file', recommendedTargetId: SYSTEM_DEFAULT_TARGET_ID, targets }
  }

  private async detectInstalledApps(): Promise<InstalledKnownExternalApp[]> {
    const cacheService = application.get('CacheService')
    const cached = cacheService.get<InstalledKnownExternalApp[]>(INSTALLED_APPS_CACHE_KEY)
    if (cached) return cached

    const apps = (
      await Promise.all(
        SUPPORTED_EXTERNAL_APPS.map(async (config) => {
          try {
            if (config.executable) return this.detectExecutableApp(config)
            if (!config.protocol) return null
            const info = await app.getApplicationInfoForProtocol(config.protocol)
            return info.name ? { ...config, path: info.path } : null
          } catch (error) {
            logger.debug('External application protocol is unavailable', { appId: config.id, error })
            return null
          }
        })
      )
    ).filter((item) => item !== null)
    logger.debug('Detected external applications', {
      apps: apps.map(({ id, path: applicationPath }) => ({ id, path: applicationPath }))
    })
    cacheService.set(INSTALLED_APPS_CACHE_KEY, apps, CACHE_DURATION_MS)
    return apps
  }

  private toKnownTarget(appInfo: InstalledKnownExternalApp): ExternalOpenTarget {
    return {
      id: `${KNOWN_TARGET_PREFIX}${appInfo.id}`,
      name: appInfo.name,
      kind: appInfo.kind
    }
  }

  private resolveTargetPath(inputPath: string): AbsoluteFilePath {
    const expanded = inputPath.startsWith('~')
      ? path.join(application.getPath('sys.home'), inputPath.replace(/^~[/\\]?/, ''))
      : inputPath
    return AbsoluteFilePathSchema.parse(path.resolve(expanded))
  }

  private getPathKind(
    targetPath: AbsoluteFilePath,
    pathKindHint?: ExternalOpenTargetPathKind
  ): ExternalOpenTargetPathKind {
    try {
      return statSync(targetPath).isDirectory() ? 'directory' : 'file'
    } catch {
      return pathKindHint ?? (path.basename(targetPath).includes('.') ? 'file' : 'directory')
    }
  }

  private getCacheKey(targetPath: AbsoluteFilePath, pathKind: 'file' | 'directory'): string {
    return pathKind === 'directory' ? pathKind : `file:${targetPath}`
  }

  private detectExecutableApp(config: KnownExternalAppConfig): InstalledKnownExternalApp | null {
    const executablePath = this.resolveExecutablePath(config)
    if (!executablePath) return null
    try {
      lstatSync(executablePath)
      return { ...config, path: executablePath }
    } catch (error) {
      logger.debug('External executable is unavailable', { appId: config.id, executablePath, error })
      return null
    }
  }

  private async openKnownApplication(
    appId: KnownExternalAppId,
    targetPath: AbsoluteFilePath,
    pathKind: ExternalOpenTargetPathKind
  ): Promise<void> {
    const config = SUPPORTED_EXTERNAL_APPS.find((item) => item.id === appId)
    if (!config) throw new Error(`Unknown external application "${appId}"`)
    if (config.protocol) {
      const url = this.buildEditorUrl(config, targetPath)
      if (!isSafeExternalUrl(url)) {
        logger.warn('Blocked unsafe external application URL', { appId, targetPath })
        throw new Error(`External application URL for "${appId}" failed safety validation`)
      }
      try {
        await shell.openExternal(url)
      } catch (error) {
        logger.error('Failed to open target with external application', { appId, targetPath, error })
        throw error
      }
      return
    }

    const executablePath = this.resolveExecutablePath(config)
    if (!executablePath) throw new Error(`Executable for external application "${appId}" was not found`)
    const directory = this.resolveTerminalDirectory(targetPath, pathKind)
    const env = { ...process.env }
    removeEnvProxy(env)
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(executablePath, ['-d', directory], { env, shell: false, windowsHide: false })
        child.once('spawn', resolve)
        child.once('error', reject)
      })
    } catch (error) {
      logger.error('Failed to open target with external application', { appId, targetPath, error })
      throw error
    }
  }

  private buildEditorUrl(config: KnownExternalAppConfig, targetPath: AbsoluteFilePath): string {
    if (!config.protocol) throw new Error(`External application "${config.id}" has no URL protocol`)
    const encodedPath = targetPath.split(/[/\\]/).map(encodeURIComponent).join('/')
    return config.id === 'zed'
      ? `${config.protocol}file${encodedPath}`
      : `${config.protocol}file/${encodedPath}?windowId=_blank`
  }

  private resolveExecutablePath(config: KnownExternalAppConfig): string | null {
    if (process.platform !== 'win32' || !config.executable) return null
    const localAppData = process.env.LOCALAPPDATA
    if (!localAppData) return null
    return path.win32.join(localAppData, 'Microsoft', 'WindowsApps', config.executable)
  }

  private resolveTerminalDirectory(targetPath: AbsoluteFilePath, pathKind: ExternalOpenTargetPathKind): string {
    return pathKind === 'file' ? path.dirname(targetPath) : targetPath
  }
}

export const externalAppService = new ExternalAppService()
