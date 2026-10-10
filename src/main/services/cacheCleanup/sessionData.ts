import path from 'node:path'

import { type Session, session } from 'electron'

import { application } from '@application'
import { loggerService } from '@logger'
import type { CacheCleanupGroupResult, CacheCleanupSizeSnapshot } from '@shared/types/cacheCleanupIpc'
import { HTML_ARTIFACT_PREVIEW_PARTITION } from '@shared/utils/htmlArtifact'

import {
  captureStep,
  type CleanupStepResult,
  issue,
  measurePaths,
  mergeMeasurements,
  removeCleanupTarget,
  resultFromSteps,
  type SizeMeasurement,
  toSizeSnapshot
} from './shared'

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
  const sessions = [
    { item: 'default_session', root: paths.defaultSession, value: session.defaultSession },
    { item: 'webview_session', root: paths.webviewSession, value: session.fromPartition('persist:webview') }
  ]
  const previewSession = {
    item: 'html_artifact_preview_session',
    value: session.fromPartition(HTML_ARTIFACT_PREVIEW_PARTITION)
  }

  const electronMeasurements = await Promise.all(
    [...sessions, previewSession].map(({ item, value }) => measureSessionCache(value, item))
  )
  const diskTargets = sessions.flatMap(({ item, root }) =>
    NORMAL_CACHE_RELATIVE_PATHS.map((relativePath) => ({
      item,
      path: path.join(root, relativePath)
    }))
  )
  diskTargets.push({ item: 'trace', path: paths.trace }, { item: 'legacy_trace', path: paths.legacyTrace })

  const diskMeasurement = await measurePaths(diskTargets)
  return toSizeSnapshot(mergeMeasurements([...electronMeasurements, diskMeasurement]), 'estimated')
}

export async function inspectSiteData(): Promise<CacheCleanupSizeSnapshot> {
  const paths = getCleanupPaths()
  const targets: Array<{ item: string; path: string; excludedPaths?: ReadonlySet<string> }> = COOKIE_RELATIVE_PATHS.map(
    (relativePath) => ({
      item: 'default_session_cookies',
      path: path.join(paths.defaultSession, relativePath)
    })
  )

  targets.push(
    ...COOKIE_RELATIVE_PATHS.map((relativePath) => ({
      item: 'webview_cookies',
      path: path.join(paths.webviewSession, relativePath)
    })),
    { item: 'webview_local_storage', path: path.join(paths.webviewSession, 'Local Storage') },
    { item: 'webview_indexeddb', path: path.join(paths.webviewSession, 'IndexedDB') },
    { item: 'webview_file_system', path: path.join(paths.webviewSession, 'File System') },
    {
      item: 'webview_service_workers',
      path: path.join(paths.webviewSession, 'Service Worker'),
      excludedPaths: new Set([path.resolve(paths.webviewSession, 'Service Worker', 'CacheStorage')])
    },
    { item: 'webview_websql', path: path.join(paths.webviewSession, 'databases') }
  )

  const measurement = await measurePaths(targets)
  measurement.issues.push(issue('html_artifact_preview_site_data', 'inspection_failed'))
  return toSizeSnapshot(measurement, 'estimated')
}

export async function clearNormalCache(): Promise<CacheCleanupGroupResult> {
  const paths = getCleanupPaths()
  const [defaultSessionSteps, webviewSessionSteps, previewSessionSteps, traceStep, legacyTraceStep] = await Promise.all(
    [
      clearSessionNormalCache(session.defaultSession, 'default_session'),
      clearSessionNormalCache(session.fromPartition('persist:webview'), 'webview_session'),
      clearSessionNormalCache(session.fromPartition(HTML_ARTIFACT_PREVIEW_PARTITION), 'html_artifact_preview_session'),
      captureStep('trace', () => application.get('TraceStorageService').cleanLocalData()),
      removeCleanupTarget({ item: 'legacy_trace', path: paths.legacyTrace, kind: 'directory' })
    ]
  )
  return resultFromSteps('normal_cache', [
    ...defaultSessionSteps,
    ...webviewSessionSteps,
    ...previewSessionSteps,
    traceStep,
    legacyTraceStep
  ])
}

export async function clearSiteData(): Promise<CacheCleanupGroupResult> {
  const steps = await Promise.all([
    captureStep('default_session_cookies', () =>
      session.defaultSession.clearData({ dataTypes: ['cookies'], avoidClosingConnections: true })
    ),
    captureStep('webview_site_data', () =>
      session.fromPartition('persist:webview').clearData({
        dataTypes: ['cookies', 'fileSystems', 'indexedDB', 'localStorage', 'serviceWorkers', 'webSQL']
      })
    ),
    captureStep('html_artifact_preview_site_data', () =>
      session.fromPartition(HTML_ARTIFACT_PREVIEW_PARTITION).clearData({
        dataTypes: ['cookies', 'fileSystems', 'indexedDB', 'localStorage', 'serviceWorkers', 'webSQL']
      })
    )
  ])
  return resultFromSteps('site_data', steps)
}
