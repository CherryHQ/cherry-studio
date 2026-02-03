import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'

import { startAutoSync } from './services/BackupService'
import { startNutstoreAutoSync } from './services/NutstoreService'
import storeSyncService from './services/StoreSyncService'
import { webTraceService } from './services/WebTraceService'
loggerService.initWindowSource('mainWindow')

function initAutoSync() {
  setTimeout(async () => {
    const autoSyncStates = await preferenceService.getMultiple({
      webdav: 'data.backup.webdav.auto_sync',
      local: 'data.backup.local.auto_sync',
      s3: 'data.backup.s3.auto_sync',
      nutstore: 'data.backup.nutstore.auto_sync'
    })

    if (autoSyncStates.webdav || autoSyncStates.s3 || autoSyncStates.local) {
      startAutoSync()
    }
    if (autoSyncStates.nutstore) {
      startNutstoreAutoSync()
    }
  }, 8000)
}

function initStoreSync() {
  storeSyncService.subscribe()
}

function initWebTrace() {
  webTraceService.init()
}

initAutoSync()
initStoreSync()
initWebTrace()
