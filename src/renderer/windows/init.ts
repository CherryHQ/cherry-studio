import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import { startAutoSync } from '@renderer/services/BackupService'
import { startNutstoreAutoSync } from '@renderer/services/NutstoreService'
import { webTraceService } from '@renderer/services/WebTraceService'
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
      void startAutoSync()
    }
    if (autoSyncStates.nutstore) {
      void startNutstoreAutoSync()
    }
  }, 8000)
}

function initWebTrace() {
  webTraceService.init()
}

initAutoSync()
initWebTrace()
