import fs from 'node:fs/promises'
import path from 'node:path'

import { type Session, session } from 'electron'

import { application } from '@application'
import { loggerService } from '@logger'
import {
  isMiniAppPartition,
  MINI_APP_PARTITION_PREFIX,
  miniAppPartition
} from '@main/features/miniApp/runtime/partition'
import type { CacheCleanupGroupResult, CacheCleanupSizeSnapshot } from '@shared/types/cacheCleanupIpc'
import { MiniAppIdSchema } from '@shared/types/miniAppManifest'
import { HTML_ARTIFACT_PREVIEW_PARTITION } from '@shared/utils/htmlArtifact'
import { getWebviewPartition, WebviewSecurityProfile } from '@shared/utils/webviewSecurity'

import {
  captureStep,
  type CleanupStepResult,
  inspectTarget,
  issue,
  measurePaths,
  mergeMeasurements,
  removeCleanupTarget,
  resultFromSteps,
  type SizeMeasurement,
  toSizeSnapshot
} from './shared'
import { clearToolchainDownloadCaches, measureToolchainDownloadCaches } from './toolchainDownloads'

const logger = loggerService.withContext('CacheCleanup')

const NORMAL_CACHE_RELATIVE_PATHS = [
  'Code Cache',
  'GPUCache',
  'ShaderCache',
  'GrShaderCache',
  'GraphiteDawnCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  path.join('Service Worker', 'CacheStorage'),
  'Shared Dictionary'
] as const

const COOKIE_RELATIVE_PATHS = [
  'Cookies',
  'Cookies-journal',
  path.join('Network', 'Cookies'),
  path.join('Network', 'Cookies-journal')
] as const

function getCleanupPaths() {
  return {
    defaultSession: application.getPath('app.session'),
    webviewSession: application.getPath('app.session.webview'),
    trace: application.getPath('feature.trace'),
    legacyTrace: application.getPath('v1.trace')
  }
}

async function inspectAdditionalPartitions() {
  const item = 'additional_partitions'
  const root = application.getPath('app.session.partitions')
  const status = await inspectTarget(root, item, 'directory')
  if (status === 'missing') return { partitions: [], issues: [] }
  if (status === 'invalid') return { partitions: [], issues: [issue(item, 'unsafe_target')] }

  try {
    const miniAppDirectoryPrefix = encodeURIComponent(MINI_APP_PARTITION_PREFIX.slice('persist:'.length))
    const entries = await fs.readdir(root, { withFileTypes: true })
    const partitions = entries.flatMap((entry) => {
      if (!entry.isDirectory()) return []
      const diskPath = path.join(root, entry.name)
      if (entry.name === 'default') return [{ name: 'persist:default', root: diskPath }]
      if (!entry.name.startsWith(miniAppDirectoryPrefix)) return []
      const appId = MiniAppIdSchema.safeParse(entry.name.slice(miniAppDirectoryPrefix.length))
      return appId.success ? [{ name: miniAppPartition(appId.data), root: diskPath }] : []
    })
    return { partitions, issues: [] }
  } catch (error) {
    logger.warn('Unable to inspect additional cache partitions', { error })
    return { partitions: [], issues: [issue(item, 'inspection_failed')] }
  }
}

async function measureSessionCache(ses: Session, item: string): Promise<SizeMeasurement> {
  try {
    const bytes = await ses.getCacheSize()
    return { bytes, issues: [] }
  } catch (error) {
    logger.warn('Failed to query Electron session cache size', { item, error })
    return { bytes: 0, issues: [issue(item, 'inspection_failed')] }
  }
}

function clearSessionNormalCache(ses: Session, item: string): Promise<CleanupStepResult[]> {
  return Promise.all([
    captureStep(`${item}_http_cache`, () => ses.clearData({ dataTypes: ['cache'], avoidClosingConnections: true })),
    captureStep(`${item}_code_cache`, () => ses.clearCodeCaches({})),
    captureStep(`${item}_shared_cache`, () => ses.clearStorageData({ storages: ['shadercache', 'cachestorage'] }))
  ])
}

export async function inspectNormalCache(): Promise<CacheCleanupSizeSnapshot> {
  const paths = getCleanupPaths()
  const agentBrowser = session.fromPartition(getWebviewPartition(WebviewSecurityProfile.AgentBrowser))
  const { partitions, issues } = await inspectAdditionalPartitions()
  const sessions = [
    { item: 'default_session', root: paths.defaultSession, value: session.defaultSession },
    { item: 'webview_session', root: paths.webviewSession, value: session.fromPartition('persist:webview') },
    { item: 'agent_browser_session', root: agentBrowser.getStoragePath(), value: agentBrowser },
    {
      item: 'html_artifact_preview_session',
      root: null,
      value: session.fromPartition(HTML_ARTIFACT_PREVIEW_PARTITION)
    },
    ...partitions.map(({ name, root }) => ({ item: name, root, value: session.fromPartition(name) }))
  ]

  const diskTargets = sessions.flatMap(({ item, root }) =>
    root ? NORMAL_CACHE_RELATIVE_PATHS.map((relativePath) => ({ item, path: path.join(root, relativePath) })) : []
  )
  diskTargets.push({ item: 'trace', path: paths.trace }, { item: 'legacy_trace', path: paths.legacyTrace })

  const measurements = await Promise.all([
    ...sessions.map(({ item, value }) => measureSessionCache(value, item)),
    measurePaths(diskTargets),
    measureToolchainDownloadCaches()
  ])
  return toSizeSnapshot(mergeMeasurements([...measurements, { bytes: 0, issues }]), 'estimated')
}

export async function inspectSiteData(): Promise<CacheCleanupSizeSnapshot> {
  const paths = getCleanupPaths()
  const targets: Array<{ item: string; path: string; excludedPaths?: ReadonlySet<string> }> = COOKIE_RELATIVE_PATHS.map(
    (relativePath) => ({
      item: 'default_session_cookies',
      path: path.join(paths.defaultSession, relativePath)
    })
  )

  const { partitions, issues } = await inspectAdditionalPartitions()
  const siteRoots = [
    paths.webviewSession,
    ...partitions.filter(({ name }) => isMiniAppPartition(name)).map(({ root }) => root)
  ]
  for (const root of siteRoots) {
    targets.push(
      ...COOKIE_RELATIVE_PATHS.map((relativePath) => ({ item: 'site_cookies', path: path.join(root, relativePath) })),
      { item: 'site_local_storage', path: path.join(root, 'Local Storage') },
      { item: 'site_indexeddb', path: path.join(root, 'IndexedDB') },
      { item: 'site_file_system', path: path.join(root, 'File System') },
      {
        item: 'site_service_workers',
        path: path.join(root, 'Service Worker'),
        excludedPaths: new Set([path.resolve(root, 'Service Worker', 'CacheStorage')])
      },
      { item: 'site_websql', path: path.join(root, 'databases') }
    )
  }

  const measurement = await measurePaths(targets)
  measurement.issues.push(...issues)
  return toSizeSnapshot(measurement, 'estimated')
}

export async function clearNormalCache(): Promise<CacheCleanupGroupResult> {
  const paths = getCleanupPaths()
  const { partitions, issues } = await inspectAdditionalPartitions()
  const [
    defaultSessionSteps,
    webviewSessionSteps,
    previewSessionSteps,
    agentBrowserStep,
    traceStep,
    legacyTraceStep,
    toolchainSteps,
    additionalPartitionSteps
  ] = await Promise.all([
    clearSessionNormalCache(session.defaultSession, 'default_session'),
    clearSessionNormalCache(session.fromPartition('persist:webview'), 'webview_session'),
    clearSessionNormalCache(session.fromPartition(HTML_ARTIFACT_PREVIEW_PARTITION), 'html_artifact_preview_session'),
    captureStep('agent_browser_session', () => application.get('BrowserSessionService').clearData('cache')),
    captureStep('trace', () => application.get('TraceStorageService').cleanLocalData()),
    removeCleanupTarget({ item: 'legacy_trace', path: paths.legacyTrace, kind: 'directory' }),
    clearToolchainDownloadCaches(),
    Promise.all(partitions.map(({ name }) => clearSessionNormalCache(session.fromPartition(name), name)))
  ])
  return resultFromSteps('normal_cache', [
    ...defaultSessionSteps,
    ...webviewSessionSteps,
    ...previewSessionSteps,
    agentBrowserStep,
    traceStep,
    legacyTraceStep,
    ...toolchainSteps,
    ...additionalPartitionSteps.flat(),
    ...issues.map((): CleanupStepResult => ({ state: 'skipped' }))
  ])
}

export async function clearSiteData(): Promise<CacheCleanupGroupResult> {
  const { partitions, issues } = await inspectAdditionalPartitions()
  const sitePartitions = [
    'persist:webview',
    HTML_ARTIFACT_PREVIEW_PARTITION,
    ...partitions.filter(({ name }) => isMiniAppPartition(name)).map(({ name }) => name)
  ]
  const steps = await Promise.all([
    captureStep('default_session_cookies', () =>
      session.defaultSession.clearData({ dataTypes: ['cookies'], avoidClosingConnections: true })
    ),
    ...sitePartitions.map((name) =>
      captureStep(name, () =>
        session.fromPartition(name).clearData({
          dataTypes: ['cookies', 'fileSystems', 'indexedDB', 'localStorage', 'serviceWorkers', 'webSQL']
        })
      )
    )
  ])
  steps.push(...issues.map((): CleanupStepResult => ({ state: 'skipped' })))
  return resultFromSteps('site_data', steps)
}
