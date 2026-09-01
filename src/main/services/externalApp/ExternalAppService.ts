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

import { resolveDefaultApplication } from './defaultApplication'

const SYSTEM_DEFAULT_TARGET_ID = 'system_default'
const FILE_MANAGER_TARGET_ID = 'file_manager'
const KNOWN_TARGET_PREFIX = 'known:'
const CACHE_DURATION_MS = 5 * 60 * 1000
const logger = loggerService.withContext('ExternalAppService')

type KnownExternalAppId = 'vscode' | 'cursor' | 'zed' | 'wt'
type ExternalOpenTargetPathKind = ExternalOpenTargetResult['pathKind']

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
  private installedAppsCache: { apps: InstalledKnownExternalApp[]; timestamp: number } | null = null
  private readonly openTargetsCache = new Map<string, { result: ExternalOpenTargetResult; timestamp: number }>()

  async listOpenTargets(
    inputPath: string,
    pathKindHint?: ExternalOpenTargetPathKind
  ): Promise<ExternalOpenTargetResult> {
    const targetPath = this.resolveTargetPath(inputPath)
    const pathKind = this.getPathKind(targetPath, pathKindHint)
    const cacheKey = this.getCacheKey(targetPath, pathKind)
    const cached = this.openTargetsCache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION_MS) return cached.result

    const result = pathKind === 'directory' ? await this.listDirectoryTargets() : await this.listFileTargets(targetPath)
    this.openTargetsCache.set(cacheKey, { result, timestamp: Date.now() })
    return result
  }

  async openTarget(inputPath: string, targetId: string, pathKindHint?: ExternalOpenTargetPathKind): Promise<void> {
    const targetPath = this.resolveTargetPath(inputPath)
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
    if (target.id.startsWith(KNOWN_TARGET_PREFIX)) {
      await this.openKnownApplication(
        target.id.slice(KNOWN_TARGET_PREFIX.length) as KnownExternalAppId,
        targetPath,
        result.pathKind
      )
      return
    }
    throw new Error(`Open target "${targetId}" cannot be launched on this platform`)
  }

  private async listDirectoryTargets(): Promise<ExternalOpenTargetResult> {
    const apps = await this.detectInstalledApps()
    const compatibleApps = apps.filter((item) => item.pathKinds.includes('directory'))
    const applicationTargets = compatibleApps
      .filter((item) => item.kind === 'application')
      .map((item) => this.toKnownTarget(item))
    const terminalTargets = compatibleApps
      .filter((item) => item.kind === 'terminal')
      .map((item) => this.toKnownTarget(item))
    return {
      pathKind: 'directory',
      recommendedTargetId: FILE_MANAGER_TARGET_ID,
      targets: [{ id: FILE_MANAGER_TARGET_ID, kind: 'file_manager' }, ...applicationTargets, ...terminalTargets]
    }
  }

  private async listFileTargets(targetPath: AbsoluteFilePath): Promise<ExternalOpenTargetResult> {
    const extension = path.extname(targetPath)
    const normalizedExtension = normalizeExt(extension)
    const dangerous = isDangerExt(normalizedExtension)
    const [installedApps, defaultApplication] = await Promise.all([
      this.detectInstalledApps(),
      dangerous ? Promise.resolve(null) : resolveDefaultApplication(targetPath)
    ])
    const applicationTargets = installedApps
      .filter((item) => item.kind === 'application' && item.pathKinds.includes('file'))
      .map((item) => this.toKnownTarget(item))
    const targets: ExternalOpenTarget[] = [
      ...(dangerous
        ? []
        : [
            {
              id: SYSTEM_DEFAULT_TARGET_ID,
              kind: 'system_default' as const,
              ...defaultApplication
            }
          ]),
      { id: FILE_MANAGER_TARGET_ID, kind: 'file_manager' },
      ...applicationTargets
    ]

    return {
      pathKind: 'file',
      recommendedTargetId: dangerous ? (applicationTargets[0]?.id ?? FILE_MANAGER_TARGET_ID) : SYSTEM_DEFAULT_TARGET_ID,
      targets
    }
  }

  private async detectInstalledApps(): Promise<InstalledKnownExternalApp[]> {
    if (this.installedAppsCache && Date.now() - this.installedAppsCache.timestamp < CACHE_DURATION_MS) {
      return this.installedAppsCache.apps
    }

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
    this.installedAppsCache = { apps, timestamp: Date.now() }
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
    return pathKind === 'directory' ? pathKind : `file:${normalizeExt(path.extname(targetPath)) ?? 'no_extension'}`
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
